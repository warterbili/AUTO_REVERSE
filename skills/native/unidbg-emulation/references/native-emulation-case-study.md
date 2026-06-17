# Native Emulation Engineering Case Study

Based on an in-depth analysis of a native emulation project, this document records a concrete implementation case for reverse engineering a sample ride-hailing App, demonstrating best practices for the Unidbg framework in real-world applications.

## Project Overview

- **Target application**: Sample ride-hailing App (com.example.target)
- **Core library**: libpsec.so
- **Main functionality**: Emulating execution of the JNI methods `nb()` and `na()`
- **Technology stack**: Unidbg + Android ARM64 emulation

## Core File Analysis

### 1. PsecMain.java - Main Entry Class

```java
public class PsecMain extends CustomJni {
    // Key fields
    public AndroidEmulator emulator;
    public VM vm;
    public Module module;
    private List<SectionSnapshot> protectedList = new ArrayList<>();
    
    // Constructor - complete initialization flow
    public PsecMain(String apkFilePath, String android_id, String randomContext, 
                   String serial, String packageName, String ua, String device, 
                   String RootDir, String LibDir) {
        // 1. Create the emulator
        AndroidEmulatorBuilder builder = new AndroidEmulatorBuilder(true) {
            @Override
            public AndroidEmulator build() {
                return new AndroidARM64Emulator(processName, rootDir, backendFactories) {
                    @Override
                    protected UnixSyscallHandler<AndroidFileIO> createSyscallHandler(SvcMemory svcMemory) {
                        return new TargetSyscallhandler(svcMemory, device);
                    }
                };
            }
        };
        
        // 2. Configure the emulator
        emulator = builder.setProcessName("com.example.target")
                .addBackendFactory(new Unicorn2Factory(true))
                .setRootDir(new File(RootDir))
                .build();
        
        // 3. Set up the memory resolver
        memory.setLibraryResolver(new AndroidResolver(23));
        
        // 4. Create the virtual machine and load the library
        vm = emulator.createDalvikVM(new File(apkFilePath));
        vm.setJni(this);
        
        // 5. Load the target library
        DalvikModule dm = vm.loadLibrary("psec", false);
        module = dm.getModule();
        
        // 6. Protect critical modules
        protectModule("libm.so");
        protectModule("libdl.so");
        protectModule("libc.so");
        protectModule("libpsec.so");
        
        // 7. Set up hooks and syscall handling
        hook_popen();
        emulator.getSyscallHandler().addIOResolver(
            new CustomStatfsResolver(emulator, bootStartTime, protectedList, RootDir, LibDir));
    }
}
```

### 2. TargetSyscallhandler.java - Syscall Customization

```java
public class TargetSyscallhandler extends ARM64SyscallHandler {
    
    @Override
    protected int pipe2(Emulator<?> emulator) {
        // Retrieve the command arguments stored by the hook
        String cmd = (String) emulator.get("command");
        String modes = (String) emulator.get("modes");
        
        // Return preset output based on the command
        String stdout = simulateCommandOutput(cmd, modes);
        
        // Create pipe file descriptors
        int write_fd = getMinFd();
        int read_fd = getMinFd();
        
        this.fdMap.put(write_fd, new DumpFileIO(write_fd));
        this.fdMap.put(read_fd, new ByteArrayFileIO(0, "pipe2_read_side", stdout.getBytes()));
        
        // Write back the file descriptors
        UnidbgPointer pipefd = UnidbgPointer.register(emulator, Arm64Const.UC_ARM64_REG_X0);
        pipefd.setInt(0, read_fd);
        pipefd.setInt(4, write_fd);
        
        return 0;
    }
    
    private String simulateCommandOutput(String cmd, String modes) {
        switch (cmd) {
            case "getprop ro.boot.vbmeta.device_state 2>&1":
                return "locked\n";
            case "su -c id 2>&1":
                return "/system/bin/sh: su: inaccessible or not found\n";
            case "magisk -v 2>&1":
                return "/system/bin/sh: magisk: inaccessible or not found\n";
            // ... more command emulations
        }
        return "";
    }
}
```

## Key Technical Implementations

### 1. Function Hook Implementation

```java
private void hook_popen() {
    Symbol popen = emulator.getMemory().findModule("libpsec.so").findSymbolByName("popen");
    if (popen != null) {
        Dobby.getInstance(emulator).replace(popen, new ReplaceCallback() {
            @Override
            public HookStatus onCall(Emulator<?> emulator, HookContext context, long originFunction) {
                UnidbgPointer command = context.getPointerArg(0);
                UnidbgPointer mode = context.getPointerArg(1);
                
                String commandStr = (command != null) ? command.getString(0) : "null";
                String modeStr = (mode != null) ? mode.getString(0) : "null";
                
                // Store the arguments for use by subsequent syscalls
                emulator.set("command", commandStr);
                emulator.set("modes", modeStr);
                
                return HookStatus.RET(emulator, originFunction);
            }
        });
    }
}
```

### 2. Memory Protection Mechanism

```java
private void protectModule(String moduleName) {
    Module module = emulator.getMemory().findModule(moduleName);
    if (module == null) {
        log.warn("Can't find module: " + moduleName);
        return;
    }
    
    // Read the module's memory data
    byte[] data = emulator.getBackend().mem_read(module.base, (int) module.size);
    
    // Add it to the protection list
    protectedList.add(new SectionSnapshot(module.base, module.base + module.size, data));
}
```

### 3. System Property Emulation

```java
private void sysPropertyEnvFix(Memory memory) {
    SystemPropertyHook hook = new SystemPropertyHook(emulator);
    hook.setPropertyProvider(new SystemPropertyProvider() {
        @Override
        public String getProperty(String key) {
            switch (key) {
                case "ro.kernel.qemu":
                    return "0"; // Hide emulator fingerprint
                case "ro.build.version.sdk":
                    return "23";
                case "ro.product.manufacturer":
                    return device != null ? device.getString("ro.product.manufacturer") : "Xiaomi";
                // ... more properties
            }
            return null;
        }
    });
    memory.addHookListener(hook);
}
```

## Core Algorithm Invocation

### 1. callNb Method Implementation

```java
public JSONObject callNb(String arg) {
    DvmClass dvmClass = vm.resolveClass("com/component/secure/N");
    String arg2 = "";
    long offset = 0x106424; // Function offset obtained through IDA analysis
    
    // Prepare the JNI call arguments
    Pointer jniEnv = vm.getJNIEnv();
    DvmObject<?> thiz = dvmClass.newObject(null);
    List<Object> args = new ArrayList<>();
    args.add(jniEnv);
    args.add(vm.addLocalObject(thiz));
    args.add(vm.addLocalObject(new StringObject(vm, arg)));
    args.add(vm.addLocalObject(new StringObject(vm, arg2)));
    
    // Call the function in the SO directly
    Number number = module.callFunction(emulator, offset, args.toArray());
    String result = vm.getObject(number.intValue()).getValue().toString();
    
    return new JSONObject(result);
}
```

### 2. callHNa Method Implementation

```java
public String callHNa(String arg1, String arg2) {
    long offset = 0xdb5f4; // Offset of the na method in the H class
    DvmClass dvmClass = vm.resolveClass("com/component/secure/H");
    Pointer jniEnv = vm.getJNIEnv();
    DvmObject<?> thiz = dvmClass.newObject(null);
    
    List<Object> args = new ArrayList<>();
    args.add(jniEnv);
    args.add(vm.addLocalObject(thiz));
    args.add(vm.addLocalObject(new StringObject(vm, arg1)));
    args.add(vm.addLocalObject(new StringObject(vm, arg2)));
    args.add(vm.addLocalObject(new ArrayObject(new StringObject[0])));
    
    Number number = module.callFunction(emulator, offset, args.toArray());
    return vm.getObject(number.intValue()).getValue().toString();
}
```

## Anti-Detection Technique Application

### 1. Complete Command-Line Emulation

```java
// Emulate complex anti-detection commands
case "echo '==7375=='; su -c id; echo '==6c73=='; ls; echo '==6d61=='; magisk -v 2>&1":
    return "==7375==\n" +
           "/system/bin/sh: su: inaccessible or not found\n" +
           "==6c73==\n" +
           "adb_keys\nacct\napex\nbin\nbootstrap-apex\nbugreports\ncache\nconfig\nd\ndata\n" +
           "data_mirror\ndebug_ramdisk\ndev\netc\ninit\ninit.environ.rc\nlinkerconfig\n" +
           "lost+found\nmetadata\nmnt\nodm\nodm_dlkm\noem\npostinstall\nproc\nproduct\n" +
           "sdcard\nsecond_stage_resources\nstorage\nsys\nsystem\nsystem_dlkm\nsystem_ext\n" +
           "tmp\nvendor\nvendor_dlkm\n" +
           "==6d61==\n" +
           "/system/bin/sh: magisk: inaccessible or not found\n";
```

### 2. Network State Emulation

```java
case "netstat -an | grep LISTEN 2>&1":
    return "unix  2      [ ACC ]     STREAM     LISTENING     253198   /dev/socket/zygote\n" +
           "unix  2      [ ACC ]     STREAM     LISTENING     16597    /dev/socket/property_service\n" +
           "unix  2      [ ACC ]     STREAM     LISTENING     2902     /dev/socket/logd\n" +
           "unix  2      [ ACC ]     SEQPACKET  LISTENING     2904     /dev/socket/logdr\n" +
           "unix  2      [ ACC ]     SEQPACKET  LISTENING     17959    /dev/socket/tombstoned_crash\n";
```

## Execution Flow

### 1. Main Program Entry

```java
public static void main(String[] args) throws DecoderException, IOException {
    String apkPath = "/path/to/target.apk";
    String android_id = "7726593a1b2c3d4e";
    String randomContext = "com.example.target.app.MainApplication@471109e";
    String serial = "921X1P88S";
    String packageName = "com.example.target";
    String ua = "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AP3A.241005.015; wv) AppleWebKit/537.36";
    
    PsecMain obj = new PsecMain(apkPath, android_id, randomContext, serial, packageName, ua, 
                               null, "rootfs", null);
    
    // Invoke the core algorithm
    String result = obj.callHNa("1768484300", "938782636_1768379354785942627_6900cec1684b4a5692218a78d9fe7104_PAX_RS_LEGACY");
    System.out.println(result);
    
    obj.destroy();
}
```

### 2. Algorithm Extraction Workflow

```java
public String getXray(String arg) {
    // Invoke the core algorithm
    JSONObject obj = callNb(arg);
    
    // Add extra parameters
    obj.put("i", "m1");
    obj.put("v", "w.4.64.0.174");
    obj.put("k", getNanoTime());
    obj.put("kv", "3");
    obj.put("oi", "mMwAS4i5r4");
    obj.put("gsid", RandomContext);
    
    // Return the Base64-encoded result
    return Base64.getEncoder().encodeToString(obj.toString().getBytes());
}
```

## Key Takeaways

### 1. Emulator Initialization Pattern

- Use AndroidEmulatorBuilder for customized construction
- Implement a custom syscall handler through subclassing
- Set up the necessary memory resolver and file system in advance

### 2. Library Loading and Protection

- Apply memory protection immediately after loading the target SO library
- Use SectionSnapshot to record the original memory state
- Verify memory integrity at critical moments

### 3. JNI Environment Completeness

- Extend CustomJni to implement a complete Android API emulation
- Use real device parameters to forge the environment
- Implement time synchronization and state consistency

### 4. Anti-Debugging Countermeasures

- Hook key functions (such as popen) to intercept commands
- Return preset output at the syscall layer
- Emulate the various states of a real Android environment

This case demonstrates the complete application of Unidbg in real-world reverse engineering, providing a valuable reference pattern for similar projects going forward.
