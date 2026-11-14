// Windows-only process lifecycle broker. This does not restrict file or network access.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class JobBroker {
    const uint CREATE_SUSPENDED = 4, EXTENDED_STARTUPINFO_PRESENT = 0x80000;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000, DUPLICATE_SAME_ACCESS = 2;
    const int STARTF_USESTDHANDLES = 0x100, PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x20002;
    const uint INFINITE = 0xffffffff;
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
        public int cb; public string reserved, desktop, title; public int x, y, xsize, ysize, xchars, ychars, fill, flags;
        public short show, reserved2; public IntPtr reservedPtr, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process, thread; public int pid, tid; }
    [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMITS {
        public long perProcessTime, perJobTime; public uint flags; public UIntPtr minWorkingSet, maxWorkingSet;
        public uint activeProcessLimit; public UIntPtr affinity; public uint priorityClass, schedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMITS {
        public BASIC_LIMITS basic; public IO_COUNTERS io; public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int info, ref EXTENDED_LIMITS limits, int length);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static void Check(bool ok, string operation) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
    // CommandLineToArgvW-compatible quoting, including trailing backslashes.
    static string Quote(string value) {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); slashes = 0; continue; }
            result.Append('\\', slashes); slashes = 0; result.Append(c);
        }
        result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
    }
    static int Launch(string executable, string[] args) {
        if (!Path.IsPathRooted(executable) || !File.Exists(executable)) throw new ArgumentException("Executable must be an existing absolute path");
        IntPtr job = IntPtr.Zero, list = IntPtr.Zero, handlesMemory = IntPtr.Zero;
        IntPtr[] std = new IntPtr[3]; PROCESS_INFORMATION pi = new PROCESS_INFORMATION(); bool initialized = false, assigned = false;
        try {
            job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero, "CreateJobObject");
            var limits = new EXTENDED_LIMITS(); limits.basic.flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(EXTENDED_LIMITS))), "SetInformationJobObject");
            for (int i = 0; i < 3; i++) {
                IntPtr source = GetStdHandle(-10 - i);
                Check(source != IntPtr.Zero && source != new IntPtr(-1), "GetStdHandle");
                Check(DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(), out std[i], 0, true, DUPLICATE_SAME_ACCESS), "DuplicateHandle");
            }
            IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            list = Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(list, 1, 0, ref size), "InitializeProcThreadAttributeList"); initialized = true;
            handlesMemory = Marshal.AllocHGlobal(IntPtr.Size * std.Length); Marshal.Copy(std, 0, handlesMemory, std.Length);
            Check(UpdateProcThreadAttribute(list, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_HANDLE_LIST), handlesMemory, new IntPtr(IntPtr.Size * std.Length), IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute");
            var startup = new STARTUPINFOEX(); startup.startup.cb = Marshal.SizeOf(typeof(STARTUPINFOEX)); startup.attributes = list;
            startup.startup.flags = STARTF_USESTDHANDLES; startup.startup.stdin = std[0]; startup.startup.stdout = std[1]; startup.startup.stderr = std[2];
            var command = new StringBuilder(Quote(executable)); foreach (string arg in args) command.Append(' ').Append(Quote(arg));
            Check(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, Path.GetDirectoryName(executable), ref startup, out pi), "CreateProcess");
            Check(AssignProcessToJobObject(job, pi.process), "AssignProcessToJobObject"); assigned = true;
            bool contained; Check(IsProcessInJob(pi.process, job, out contained) && contained, "IsProcessInJob");
            Check(ResumeThread(pi.thread) != 0xffffffff, "ResumeThread");
            Check(WaitForSingleObject(pi.process, INFINITE) == 0, "WaitForSingleObject");
            uint exit; Check(GetExitCodeProcess(pi.process, out exit), "GetExitCodeProcess"); return unchecked((int)exit);
        } finally {
            // A child that could not be assigned must never be resumed or abandoned suspended.
            if (pi.process != IntPtr.Zero && !assigned) { TerminateProcess(pi.process, 1); WaitForSingleObject(pi.process, 5000); }
            if (pi.thread != IntPtr.Zero) CloseHandle(pi.thread);
            if (pi.process != IntPtr.Zero) CloseHandle(pi.process);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (initialized) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (handlesMemory != IntPtr.Zero) Marshal.FreeHGlobal(handlesMemory);
            foreach (IntPtr handle in std) if (handle != IntPtr.Zero) CloseHandle(handle);
        }
    }
    static int Main(string[] args) {
        try {
            if (args.Length < 1) throw new ArgumentException("Expected an executable path");
            string[] childArgs = new string[args.Length - 1]; Array.Copy(args, 1, childArgs, 0, childArgs.Length);
            return Launch(args[0], childArgs);
        } catch (Exception e) { Console.Error.WriteLine("JOB_BROKER_FAILED: " + e.GetType().Name + ": " + e.Message); return 125; }
    }
}
