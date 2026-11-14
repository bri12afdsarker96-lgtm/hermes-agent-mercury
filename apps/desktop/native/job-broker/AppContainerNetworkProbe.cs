// Synthetic local-only AppContainer probe. No production services or DNS resolvers are contacted.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class AppContainerNetworkProbe {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
        public int cb; public string reserved, desktop, title; public int x,y,xs,ys,xc,yc,fill,flags; public short show,reserved2; public IntPtr ptr,stdin,stdout,stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process, thread; public int pid, tid; }
    [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr sid, capabilities; public uint count, reserved; }
    [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr caps, uint count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr str);
    [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, int flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr handle, uint code);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, int access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int info, out int value, int size, out int returned);
    static void Check(bool ok, string operation) { if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), operation); }
    static string Q(string value) { return "\"" + value + "\""; }
    static string Try(Action action) { try { action(); return "allowed"; } catch (Exception e) { var s=e as SocketException; return e.GetType().Name + (s == null ? "" : ":" + s.SocketErrorCode); } }
    static bool IsContainer() { IntPtr token; Check(OpenProcessToken(GetCurrentProcess(), 8, out token), "OpenProcessToken"); try { int result, size; Check(GetTokenInformation(token, 29, out result, 4, out size), "GetTokenInformation"); return result == 1; } finally { CloseHandle(token); } }
    static void Tcp(IPAddress address, int port) { using (var c = new TcpClient()) { var a = c.BeginConnect(address, port, null, null); using (a.AsyncWaitHandle) { if (!a.AsyncWaitHandle.WaitOne(1200)) throw new TimeoutException(); c.EndConnect(a); } } }
    static void Udp(IPAddress address, int port, byte[] message) { using (var c = new UdpClient()) { c.Client.ReceiveTimeout=1200; c.Connect(address, port); c.Send(message, message.Length); IPEndPoint peer=null; byte[] response=c.Receive(ref peer); if (response.Length != message.Length) throw new InvalidDataException(); } }
    // A syntactically valid DNS question for a reserved synthetic name; the local server only echoes it.
    static readonly byte[] DnsQuestion = {0x12,0x34,1,0,0,1,0,0,0,0,0,0,9,115,121,110,116,104,101,116,105,99,7,105,110,118,97,108,105,100,0,0,1,0,1};
    static void Worker(string[] args) {
        string role=args[1], root=args[2]; IPAddress ip=IPAddress.Parse(args[3]); int tcp=int.Parse(args[4]), udp=int.Parse(args[5]), dns=int.Parse(args[6]);
        var b=new StringBuilder(); b.AppendLine("container="+IsContainer());
        b.AppendLine("tcp="+Try(()=>Tcp(ip,tcp))); b.AppendLine("udp="+Try(()=>Udp(ip,udp,new byte[]{1,2,3})));
        b.AppendLine("dns_transport="+Try(()=>Udp(ip,dns,DnsQuestion)));
        if (role=="child") {
            var start=new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "worker grandchild "+Q(root)+" "+ip+" "+tcp+" "+udp+" "+dns) { UseShellExecute=false, CreateNoWindow=true, WorkingDirectory=root };
            using (var p=Process.Start(start)) { if(!p.WaitForExit(12000)) { p.Kill(); throw new Exception("grandchild timed out"); } if(p.ExitCode!=0) throw new Exception("grandchild failed"); }
        }
        File.WriteAllText(Path.Combine(root,role+".txt"),b.ToString());
    }
    static int udpReceived, dnsReceived;
    static void Echo(UdpClient server, bool isDns) { try { while (true) { IPEndPoint peer=null; var bytes=server.Receive(ref peer); if(isDns) Interlocked.Increment(ref dnsReceived); else Interlocked.Increment(ref udpReceived); server.Send(bytes,bytes.Length,peer); } } catch (ObjectDisposedException) {} catch (SocketException) {} }
    static int Main(string[] args) {
        if(args.Length>0 && args[0]=="worker") { try { Worker(args); return 0; } catch(Exception e) { Console.Error.WriteLine(e); return 1; } }
        IPAddress ip; if(args.Length!=1 || !IPAddress.TryParse(args[0],out ip) || ip.AddressFamily!=AddressFamily.InterNetwork || IPAddress.IsLoopback(ip)) throw new ArgumentException("Supply a non-loopback local IPv4 address");
        bool local=false; foreach(var nic in NetworkInterface.GetAllNetworkInterfaces()) foreach(var unicast in nic.GetIPProperties().UnicastAddresses) if(unicast.Address.Equals(ip)) local=true;
        if(!local) throw new ArgumentException("Address must belong to this host");
        string root=Path.Combine(Path.GetTempPath(),"hermes-network-probe-"+Guid.NewGuid().ToString("N")), name="Hermes.NetworkProbe."+Guid.NewGuid().ToString("N");
        IntPtr sid=IntPtr.Zero, sidText=IntPtr.Zero, list=IntPtr.Zero, caps=IntPtr.Zero, env=IntPtr.Zero; bool created=false, initialized=false; PROCESS_INFORMATION pi=new PROCESS_INFORMATION();
        TcpListener tcp=null; UdpClient udp=null, dns=null; Thread udpThread=null, dnsThread=null;
        try {
            Directory.CreateDirectory(root); string exe=Path.Combine(root,"probe.exe"); File.Copy(Process.GetCurrentProcess().MainModule.FileName,exe);
            int hr=CreateAppContainerProfile(name,name,"Local synthetic network probe",IntPtr.Zero,0,out sid); if(hr!=0) throw new Exception("CreateAppContainerProfile="+hr); created=true;
            Check(ConvertSidToStringSid(sid,out sidText),"ConvertSidToStringSid");
            using(var acl=Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"icacls.exe"),Q(root)+" /grant *"+Marshal.PtrToStringUni(sidText)+":(OI)(CI)M /T /C /Q") { UseShellExecute=false, CreateNoWindow=true })) { acl.WaitForExit(); if(acl.ExitCode!=0) throw new Exception("Synthetic ACL failed"); }
            tcp=new TcpListener(ip,0); tcp.Start(); udp=new UdpClient(new IPEndPoint(ip,0)); dns=new UdpClient(new IPEndPoint(ip,0));
            int tp=((IPEndPoint)tcp.LocalEndpoint).Port, up=((IPEndPoint)udp.Client.LocalEndPoint).Port, dp=((IPEndPoint)dns.Client.LocalEndPoint).Port;
            var udpServer=udp; var dnsServer=dns; udpThread=new Thread(()=>Echo(udpServer,false)); dnsThread=new Thread(()=>Echo(dnsServer,true)); udpThread.IsBackground=true; dnsThread.IsBackground=true; udpThread.Start(); dnsThread.Start();
            Tcp(ip,tp); using(var accepted=tcp.AcceptTcpClient()) {} Udp(ip,up,new byte[]{1,2,3}); Udp(ip,dp,DnsQuestion); Console.WriteLine("host_tcp=allowed\nhost_udp=allowed\nhost_dns_transport=allowed");
            IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size); list=Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(list,1,0,ref size),"InitializeProcThreadAttributeList"); initialized=true;
            caps=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES))); Marshal.StructureToPtr(new SECURITY_CAPABILITIES { sid=sid },caps,false);
            Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20009),caps,new IntPtr(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES))),IntPtr.Zero,IntPtr.Zero),"UpdateProcThreadAttribute");
            var si=new STARTUPINFOEX(); si.startup.cb=Marshal.SizeOf(typeof(STARTUPINFOEX)); si.attributes=list;
            string environment="APPDATA="+root+"\0LOCALAPPDATA="+root+"\0SystemDrive="+Path.GetPathRoot(Environment.SystemDirectory).TrimEnd('\\')+"\0SystemRoot="+Environment.GetEnvironmentVariable("SystemRoot")+"\0TEMP="+root+"\0TMP="+root+"\0USERPROFILE="+root+"\0\0"; env=Marshal.StringToHGlobalUni(environment);
            Check(CreateProcess(exe,new StringBuilder(Q(exe)+" worker child "+Q(root)+" "+ip+" "+tp+" "+up+" "+dp),IntPtr.Zero,IntPtr.Zero,false,0x80400,env,root,ref si,out pi),"CreateProcess");
            if(WaitForSingleObject(pi.process,20000)!=0) { TerminateProcess(pi.process,1); throw new Exception("child timed out"); }
            uint exit; Check(GetExitCodeProcess(pi.process,out exit),"GetExitCodeProcess"); if(exit!=0) throw new Exception("child exit="+exit);
            foreach(string role in new[]{"child","grandchild"}) Console.WriteLine(role+":\n"+File.ReadAllText(Path.Combine(root,role+".txt")));
            Console.WriteLine("server_tcp_pending="+tcp.Pending()+"\nserver_udp_received="+udpReceived+"\nserver_dns_received="+dnsReceived);
            return 0;
        } catch(Exception e) { Console.Error.WriteLine(e); return 1; }
        finally {
            if(tcp!=null) tcp.Stop(); if(udp!=null) udp.Close(); if(dns!=null) dns.Close(); if(udpThread!=null) udpThread.Join(2000); if(dnsThread!=null) dnsThread.Join(2000);
            if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread); if(pi.process!=IntPtr.Zero) CloseHandle(pi.process);
            if(initialized) DeleteProcThreadAttributeList(list); if(list!=IntPtr.Zero) Marshal.FreeHGlobal(list); if(caps!=IntPtr.Zero) Marshal.FreeHGlobal(caps); if(env!=IntPtr.Zero) Marshal.FreeHGlobal(env);
            if(sidText!=IntPtr.Zero) LocalFree(sidText); if(sid!=IntPtr.Zero) FreeSid(sid);
            if(created) Console.WriteLine("delete_profile_hresult="+DeleteAppContainerProfile(name));
            try { Directory.Delete(root,true); Console.WriteLine("temporary_directory_removed=True"); } catch(Exception e) { Console.WriteLine("temporary_directory_removed=False:"+e.Message); }
        }
    }
}
