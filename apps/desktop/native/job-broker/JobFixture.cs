using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class JobFixture {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
        public int cb; public string reserved, desktop, title; public int x, y, xs, ys, xc, yc, fill, flags;
        public short show, reserved2; public IntPtr ptr, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process, thread; public int pid, tid; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetEvent(IntPtr handle);
    static bool InJob() { bool result; if (!IsProcessInJob(GetCurrentProcess(), IntPtr.Zero, out result)) throw new Exception("IsProcessInJob failed"); return result; }
    static int Main(string[] args) {
        if (args[0] == "handle") {
            bool allowed = SetEvent(new IntPtr(long.Parse(args[1])));
            File.WriteAllText(args[2], allowed.ToString()); return 0;
        }
        if (args[0] == "grandchild") {
            File.WriteAllText(args[1], Process.GetCurrentProcess().Id + "|" + InJob());
            Thread.Sleep(60000); return 0;
        }
        if (args[0] != "parent") return 2;
        string exe = Process.GetCurrentProcess().MainModule.FileName;
        var start = new ProcessStartInfo(exe, "grandchild \"" + args[1] + "\"");
        start.UseShellExecute = false; start.CreateNoWindow = true;
        using (var grandchild = Process.Start(start)) {
            for (int i = 0; i < 100 && !File.Exists(args[1]); i++) Thread.Sleep(50);
            if (!File.Exists(args[1])) return 3;
            var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(typeof(STARTUPINFO)); PROCESS_INFORMATION pi;
            bool escaped = CreateProcess(exe, new StringBuilder("\"" + exe + "\" grandchild \"" + args[1] + ".escape\""), IntPtr.Zero, IntPtr.Zero, false, 0x01000004, IntPtr.Zero, Path.GetDirectoryName(exe), ref si, out pi);
            int error = escaped ? 0 : Marshal.GetLastWin32Error();
            if (escaped) { TerminateProcess(pi.process, 1); CloseHandle(pi.thread); CloseHandle(pi.process); }
            Console.WriteLine("ready|" + Process.GetCurrentProcess().Id + "|" + InJob() + "|" + File.ReadAllText(args[1]) + "|" + escaped + "|" + error);
            Console.Out.Flush();
            Console.ReadLine();
            return 0;
        }
    }
}
