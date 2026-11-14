using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class JobBrokerTests {
    [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int length; public IntPtr descriptor; public bool inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
        public int cb; public string reserved, desktop, title; public int x, y, xs, ys, xc, yc, fill, flags;
        public short show, reserved2; public IntPtr ptr, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process, thread; public int pid, tid; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateEvent(ref SECURITY_ATTRIBUTES attributes, bool manual, bool initial, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ResetEvent(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    static bool Alive(int pid) { try { using (var p = Process.GetProcessById(pid)) return !p.HasExited; } catch (ArgumentException) { return false; } }
    static void WaitGone(int pid) { for (int i = 0; i < 100 && Alive(pid); i++) Thread.Sleep(50); Assert(!Alive(pid), "process still alive: " + pid); }
    static void Stop(int pid) { try { using (var p = Process.GetProcessById(pid)) { if (!p.HasExited) { p.Kill(); p.WaitForExit(5000); } } } catch (ArgumentException) {} }
    static string Q(string s) { return "\"" + s + "\""; }
    static void HandleScenario(string broker, string fixture, string root) {
        var security = new SECURITY_ATTRIBUTES(); security.length = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)); security.inherit = true;
        IntPtr marker = CreateEvent(ref security, true, false, null); Assert(marker != IntPtr.Zero, "CreateEvent failed");
        try {
            foreach (bool throughBroker in new[]{false, true}) {
                string output = Path.Combine(root, throughBroker ? "handle-broker.txt" : "handle-control.txt");
                string executable = throughBroker ? broker : fixture;
                string args = (throughBroker ? Q(fixture) + " " : "") + "handle " + marker.ToInt64() + " " + Q(output);
                var startup = new STARTUPINFO(); startup.cb = Marshal.SizeOf(typeof(STARTUPINFO)); PROCESS_INFORMATION pi;
                Assert(CreateProcess(executable, new StringBuilder(Q(executable) + " " + args), IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, root, ref startup, out pi), "handle control CreateProcess failed: " + Marshal.GetLastWin32Error());
                try { Assert(WaitForSingleObject(pi.process, 10000) == 0, "handle fixture timed out"); }
                finally { CloseHandle(pi.thread); CloseHandle(pi.process); }
                Assert(File.Exists(output), "handle fixture output missing");
                bool gotHandle = File.ReadAllText(output) == "True";
                bool signaled = WaitForSingleObject(marker, 0) == 0;
                Console.WriteLine((throughBroker ? "broker" : "control") + "_unrelated_handle=" + gotHandle + ";signaled=" + signaled);
                Assert(gotHandle == !throughBroker && signaled == !throughBroker, "handle inheritance control failed");
                Assert(ResetEvent(marker), "ResetEvent failed");
            }
        } finally { CloseHandle(marker); }
    }
    static void Scenario(string broker, string fixture, string root, string mode) {
        string record = Path.Combine(root, mode + ".txt");
        string executable = mode == "control" ? fixture : broker;
        string arguments = (mode == "control" ? "" : Q(fixture) + " ") + "parent " + Q(record);
        var info = new ProcessStartInfo(executable, arguments) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        int child = 0, grandchild = 0;
        using (var process = Process.Start(info)) {
            try {
                var lineTask = process.StandardOutput.ReadLineAsync();
                Assert(lineTask.Wait(10000), mode + " readiness timed out");
                string line = lineTask.Result; Assert(line != null, mode + " missing readiness");
                Console.WriteLine(mode + "=" + line);
                string[] fields = line.Split('|'); Assert(fields.Length == 7 && fields[0] == "ready", mode + " malformed result");
                child = int.Parse(fields[1]); grandchild = int.Parse(fields[3]);
                Assert(Alive(child) && Alive(grandchild), mode + " processes not alive");
                if (mode != "control") {
                    Assert(fields[2] == "True" && fields[4] == "True", mode + " missing job membership");
                    Assert(fields[5] == "False" && fields[6] == "5", mode + " breakaway not denied");
                }
                if (mode == "kill") process.Kill(); else { process.StandardInput.WriteLine("exit"); process.StandardInput.Flush(); }
                Assert(process.WaitForExit(10000), mode + " launcher did not exit");
                if (mode == "control") { Assert(Alive(grandchild), "control grandchild did not survive parent exit"); Console.WriteLine("control_descendant_survived=True"); }
                else { WaitGone(child); WaitGone(grandchild); Console.WriteLine(mode + "_descendants_terminated=True"); }
            } finally {
                if (!process.HasExited) { process.Kill(); process.WaitForExit(5000); }
                if (child != 0) Stop(child); if (grandchild != 0) Stop(grandchild);
            }
        }
    }
    static int Main(string[] args) {
        string root = Path.Combine(Path.GetTempPath(), "hermes-job-test-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        try {
            Scenario(args[0], args[1], root, "control");
            Scenario(args[0], args[1], root, "graceful");
            Scenario(args[0], args[1], root, "kill");
            HandleScenario(args[0], args[1], root);
            var bad = new ProcessStartInfo(args[0], Q(Path.Combine(root, "missing.exe"))) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using (var p = Process.Start(bad)) { Assert(p.WaitForExit(5000) && p.ExitCode == 125, "missing executable did not fail closed"); Console.WriteLine("missing_executable_rejected=True"); }
            Console.WriteLine("job_tests=PASS"); return 0;
        } catch (Exception e) { Console.Error.WriteLine(e); return 1; }
        finally {
            foreach (string file in Directory.GetFiles(root)) File.Delete(file);
            Directory.Delete(root);
        }
    }
}
