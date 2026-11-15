using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace DoudianAutomationTool
{
    // Wrap the upstream Chrome I/O stub. Host, workflow and resume policy stay real.
    internal static class PaymentControlsCdpFixture
    {
        internal const string PriorPaid = "已打款｜原有合成记录";
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static string directory, gate;
        private static bool gated;
        private static PaymentCdpChromeStub chrome;
        internal static decimal Amount;

        private static void Trace(string kind, object data)
        {
            File.AppendAllText(Path.Combine(directory, "cdp-events.jsonl"), Json.Serialize(new {
                at = DateTime.UtcNow.ToString("o"), pid = Process.GetCurrentProcess().Id,
                kind = kind, data = data
            }) + "\n");
        }

        private static void Gate(string method, string order)
        {
            if (method != "confirmation" || gated) return;
            gated = true;
            File.WriteAllText(Path.Combine(directory, gate + ".entered.json"), Json.Serialize(new {
                pid = Process.GetCurrentProcess().Id, method = method, order = order
            }));
            Trace("gate-entered", new { method = method, order = order });
            if (!SpinWait.SpinUntil(() => File.Exists(Path.Combine(directory, gate + ".release")), TimeSpan.FromSeconds(30)))
                throw new TimeoutException("CDP fixture response gate timed out");
            Trace("gate-released", new { method = method, order = order });
        }

        internal static void Start()
        {
            directory = Path.GetDirectoryName(PaymentFixture.StatePath);
            gate = Environment.GetEnvironmentVariable("HERMES_PAYMENT_PIPE_GATE");
            if (String.IsNullOrEmpty(gate) || Path.GetFileName(gate) != gate)
                throw new InvalidOperationException("Invalid CDP fixture gate");
            if (!Decimal.TryParse(Environment.GetEnvironmentVariable("HERMES_PAYMENT_PIPE_AMOUNT"),
                NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out Amount) || Amount <= 0 || Amount > 100000m)
                throw new InvalidOperationException("Invalid CDP fixture amount");
            PaymentFixture.Book.Worksheets.Sheet.Orders.Add(4, "666666666666666666");
            PaymentFixture.Book.Worksheets.Sheet.Orders.Add(5, "777777777777777777");
            PaymentFixture.Book.Worksheets.Sheet.Orders.Add(6, "888888888888888888");
            PaymentFixture.Book.Worksheets.Sheet.Orders.Add(7, "999999999999999999");
            PaymentFixture.Book.Worksheets.Sheet.Results.Add(4, PriorPaid);
            string calls = Path.Combine(directory, "calls.txt");
            if (!File.Exists(calls)) File.WriteAllText(calls, "");
            chrome = new PaymentCdpChromeStub();
            chrome.ExpectedAmount = Amount;
            chrome.IneligibleRecords["777777777777777777"] = "暂无记录";
            chrome.IneligibleRecords["888888888888888888"] = PaymentCdpChromeStub.ExactRecord + "，其他信息";
            chrome.IneligibleRecords["999999999999999999"] = "补差价 5元 打款成功";

            var attach = ChromeBrowserSession.AttachFeigeForTest;
            var selectAll = ChromeBrowserSession.SelectAllTextForTest;
            var insert = ChromeBrowserSession.InsertTextForTest;
            var evaluate = ChromeBrowserSession.EvaluateForTest;
            var close = ChromeBrowserSession.CloseForTest;
            ChromeBrowserSession.AttachFeigeForTest = token => {
                var result = attach(token);
                Trace("attach", new { synthetic = true });
                return result;
            };
            ChromeBrowserSession.SelectAllTextForTest = token => {
                var result = selectAll(token);
                Trace("select-all", new { count = chrome.SelectAllCount });
                return result;
            };
            ChromeBrowserSession.InsertTextForTest = (value, token) => {
                var result = insert(value, token);
                Trace("input", new { value = value });
                return result;
            };
            ChromeBrowserSession.EvaluateForTest = (script, token) => {
                object result = evaluate(script, token).GetAwaiter().GetResult();
                if (script == PaymentCdpChromeStub.ResourceScript)
                {
                    Trace("resource", new { name = PaymentCdpChromeStub.ResourceName });
                    return Task.FromResult(result);
                }
                const string prefix = "globalThis.zaoniaoPayment.";
                int opening = script.IndexOf('(', prefix.Length);
                string method = script.Substring(prefix.Length, opening - prefix.Length);
                object[] args = Json.Deserialize<object[]>("[" + script.Substring(opening + 1, script.Length - opening - 2) + "]");
                string order = (string)args[0];
                Trace("method", new { method = method, order = order, args = args, reply = result });
                if (method == "submit" || method == "confirm") File.AppendAllText(calls, method + "\n");
                Gate(method, order);
                return Task.FromResult(result);
            };
            ChromeBrowserSession.CloseForTest = token => {
                var result = close(token);
                Trace("close", new { cancelledSession = chrome.ClosedWithCancelledSession,
                    independentCleanup = !token.CanBeCanceled, intentChecks = chrome.IntentChecks,
                    screenConfirms = PaymentFixture.ConfirmCalls, screenSecondConfirms = PaymentFixture.SecondConfirmCalls });
                return result;
            };
            Trace("fixture", new { boundary = "synthetic Chrome I/O", gate = gate,
                exactRecord = PaymentCdpChromeStub.ExactRecord, amount = Amount, paymentType = "补差价" });
        }
    }
}
