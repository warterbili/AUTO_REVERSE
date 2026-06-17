# Unidbg Quick-Start Guide

This guide helps you quickly set up a Unidbg environment and run your first Android reverse-engineering project.

## Environment Setup

### 1. Prerequisites

```bash
# Check the Java version (JDK 8+ required)
java -version

# Check the Maven version (3.6+ required)
mvn -version

# Ensure sufficient memory is available (4GB+ recommended)
free -h
```

### 2. Project Initialization

```bash
# Create the project directory
mkdir my-unidbg-project
cd my-unidbg-project

# Create the Maven project structure
mkdir -p src/main/java/com/company/reverse
mkdir -p src/test/java
mkdir -p rootfs/system/{lib,lib64,bin,etc}
mkdir -p rootfs/data/user/0
mkdir -p rootfs/proc
```

### 3. pom.xml Configuration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    
    <groupId>com.company</groupId>
    <artifactId>unidbg-reverse</artifactId>
    <version>1.0-SNAPSHOT</version>
    
    <properties>
        <maven.compiler.source>8</maven.compiler.source>
        <maven.compiler.target>8</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>
    
    <dependencies>
        <!-- Unidbg core dependencies -->
        <dependency>
            <groupId>com.github.zhkl0228</groupId>
            <artifactId>unidbg-android</artifactId>
            <version>0.9.9-SNAPSHOT</version>
        </dependency>
        <dependency>
            <groupId>com.github.zhkl0228</groupId>
            <artifactId>unidbg-api</artifactId>
            <version>0.9.9-SNAPSHOT</version>
        </dependency>
        
        <!-- Backend support -->
        <dependency>
            <groupId>com.github.zhkl0228</groupId>
            <artifactId>unicorn2</artifactId>
            <version>0.9.9-SNAPSHOT</version>
        </dependency>
        
        <!-- Logging dependencies -->
        <dependency>
            <groupId>org.slf4j</groupId>
            <artifactId>slf4j-api</artifactId>
            <version>2.0.16</version>
        </dependency>
        <dependency>
            <groupId>org.slf4j</groupId>
            <artifactId>slf4j-reload4j</artifactId>
            <version>2.0.16</version>
        </dependency>
        
        <!-- JSON processing -->
        <dependency>
            <groupId>org.json</groupId>
            <artifactId>json</artifactId>
            <version>20230227</version>
        </dependency>
        
        <!-- Testing framework -->
        <dependency>
            <groupId>junit</groupId>
            <artifactId>junit</artifactId>
            <version>4.13.2</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
```

## First Example

### 1. Basic Emulator Class

```java
package com.company.reverse;

import com.github.unidbg.AndroidEmulator;
import com.github.unidbg.Module;
import com.github.unidbg.arm.backend.Unicorn2Factory;
import com.github.unidbg.linux.android.AndroidARMEmulator;
import com.github.unidbg.linux.android.AndroidEmulatorBuilder;
import com.github.unidbg.linux.android.AndroidResolver;
import com.github.unidbg.linux.android.dvm.*;
import com.github.unidbg.memory.Memory;
import com.github.unidbg.virtualmodule.android.AndroidModule;
import com.github.unidbg.virtualmodule.android.JniGraphics;

import java.io.File;
import java.io.IOException;

public class SimpleAndroidReverse extends AbstractJni {
    
    private AndroidEmulator emulator;
    private VM vm;
    private Module module;
    
    public SimpleAndroidReverse() {
        // 1. Create the emulator
        AndroidEmulatorBuilder builder = AndroidEmulatorBuilder.for32Bit();
        emulator = builder
            .setProcessName("com.example.app")
            .addBackendFactory(new Unicorn2Factory(true))
            .setRootDir(new File("rootfs"))
            .build();
        
        // 2. Set up the library resolver
        Memory memory = emulator.getMemory();
        memory.setLibraryResolver(new AndroidResolver(23));
        
        // 3. Create the virtual machine
        vm = emulator.createDalvikVM();
        vm.setJni(this);
        vm.setVerbose(true);
        
        // 4. Register the required modules
        new AndroidModule(emulator, vm).register(memory);
        new JniGraphics(emulator, vm).register(memory);
    }
    
    public void loadLibrary(String libName) {
        // Load the target SO library
        DalvikModule dm = vm.loadLibrary(libName, false);
        module = dm.getModule();
        dm.callJNI_OnLoad(emulator);
    }
    
    public String callStringMethod(String className, String methodName, Object... args) {
        DvmClass dvmClass = vm.resolveClass(className);
        DvmObject<?> instance = dvmClass.newObject(null);
        
        // Call the method (adjust according to the actual method signature)
        return instance.callJniMethod(emulator, methodName, args).getValue().toString();
    }
    
    public void destroy() throws IOException {
        emulator.close();
    }
    
    // Methods that must be implemented when extending AbstractJni
    @Override
    public DvmObject<?> getObjectField(BaseVM vm, DvmObject<?> dvmObject, String signature) {
        // Implement the field-retrieval logic as needed
        throw new UnsupportedOperationException("getObjectField: " + signature);
    }
    
    @Override
    public boolean callBooleanMethod(BaseVM vm, DvmObject<?> dvmObject, String signature, VarArg varArg) {
        // Implement the boolean method call as needed
        throw new UnsupportedOperationException("callBooleanMethod: " + signature);
    }
    
    // ... other required method implementations
}
```

### 2. Usage Example

```java
public class Main {
    public static void main(String[] args) {
        try {
            SimpleAndroidReverse reverse = new SimpleAndroidReverse();
            
            // Load the target library
            reverse.loadLibrary("target_lib");
            
            // Call the JNI method
            String result = reverse.callStringMethod("com/example/Target", "encryptString", "hello");
            System.out.println("Result: " + result);
            
            // Release resources
            reverse.destroy();
            
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

## Common Configuration Templates

### 1. Syscall Handler

```java
public class CustomSyscallHandler extends ARM32SyscallHandler {
    
    public CustomSyscallHandler(SvcMemory svcMemory) {
        super(svcMemory);
    }
    
    @Override
    protected int open(Emulator<?> emulator, String pathname, int flags) {
        System.out.println("Open file: " + pathname);
        
        // Emulate file access
        if ("/proc/version".equals(pathname)) {
            return createSimpleFileIO(
                "Linux version 4.4.0-android (android-build@google.com)");
        }
        
        return super.open(emulator, pathname, flags);
    }
    
    private int createSimpleFileIO(String content) {
        ByteArrayFileIO fileIO = new ByteArrayFileIO(0, "custom", content.getBytes());
        return addFileIO(fileIO);
    }
}
```

### 2. JNI Method Implementation Template

```java
@Override
public DvmObject<?> callObjectMethod(BaseVM vm, DvmObject<?> dvmObject, DvmMethod dvmMethod, VarArg varArg) {
    String signature = dvmObject.getObjectType() + "->" + dvmMethod.getMethodName() + dvmMethod.getSignature();
    
    switch (signature) {
        case "android/content/Context->getPackageName()Ljava/lang/String;":
            return new StringObject(vm, "com.example.app");
            
        case "android/content/Context->getSystemService(Ljava/lang/String;)Ljava/lang/Object;":
            String serviceName = varArg.<StringObject>getObjectArg(0).getValue();
            return createSystemService(vm, serviceName);
            
        case "java/lang/System->getProperty(Ljava/lang/String;)Ljava/lang/String;":
            String key = varArg.<StringObject>getObjectArg(0).getValue();
            return new StringObject(vm, getSystemProperty(key));
    }
    
    throw new UnsupportedOperationException("Unimplemented method: " + signature);
}

private DvmObject<?> createSystemService(BaseVM vm, String serviceName) {
    switch (serviceName) {
        case "phone":
            return vm.resolveClass("android/telephony/TelephonyManager").newObject(null);
        case "wifi":
            return vm.resolveClass("android/net/wifi/WifiManager").newObject(null);
        default:
            return null;
    }
}

private String getSystemProperty(String key) {
    switch (key) {
        case "os.arch":
            return "armv7l";
        case "java.vm.version":
            return "2.1.0";
        default:
            return null;
    }
}
```

## Debugging Tips

### 1. Enable Verbose Logging

```java
// When creating the virtual machine
vm.setVerbose(true);
emulator.getSyscallHandler().setVerbose(true);

// Configure log levels via logback.xml
```

### 2. Memory and Code Tracing

```java
// Trace memory reads and writes
emulator.traceRead(0x40000000L, 0x50000000L, (emulator1, address, size, value) -> {
    System.out.printf("Read: 0x%x = 0x%x (size: %d)\n", address, value, size);
});

emulator.traceWrite(0x40000000L, 0x50000000L, (emulator1, address, size, value) -> {
    System.out.printf("Write: 0x%x = 0x%x (size: %d)\n", address, value, size);
});

// Trace code execution
emulator.traceCode(module.base, module.base + module.size, (emulator1, address, size, user) -> {
    System.out.printf("Execute: 0x%x\n", address);
});
```

### 3. Breakpoint Debugging

```java
// Set a breakpoint
emulator.attach().addBreakPoint(module, 0x1000, new BreakPointCallback() {
    @Override
    public boolean onHit(Emulator<?> emulator, long address) {
        System.out.println("Breakpoint hit at: 0x" + Long.toHexString(address));
        emulator.showRegs(); // Display the register state
        return true; // Continue execution
    }
});
```

## Common Issue Resolution

### 1. Library Load Failure

```java
// Check the library file path
File libFile = new File("path/to/lib.so");
if (!libFile.exists()) {
    throw new RuntimeException("Library not found: " + libFile.getAbsolutePath());
}

// Manually specify the library path
emulator.getMemory().addModulePath(new File("libs"));
```

### 2. JNI Method Not Implemented

```java
// Add a default implementation in AbstractJni
@Override
public DvmObject<?> callObjectMethod(BaseVM vm, DvmObject<?> dvmObject, DvmMethod dvmMethod, VarArg varArg) {
    String signature = dvmObject.getObjectType() + "->" + dvmMethod.getMethodName() + dvmMethod.getSignature();
    
    // Log the unimplemented method
    System.err.println("Unimplemented JNI method: " + signature);
    
    // Return a default value to avoid a crash
    if (signature.endsWith("Ljava/lang/String;")) {
        return new StringObject(vm, "");
    }
    
    return null;
}
```

### 3. Memory Access Error

```java
// Pre-map the required memory regions
emulator.getMemory().mmap(0x40000000L, 0x10000000L, 
    UnicornConst.UC_PROT_READ | UnicornConst.UC_PROT_WRITE);

// Validate the address
if (address < 0x10000 || address > 0x7FFFFFFFL) {
    throw new IllegalArgumentException("Invalid memory address: 0x" + Long.toHexString(address));
}
```

## Next Steps

1. Read the full [SKILL.md](../SKILL.md) to learn about advanced features
2. Review [native-emulation-case-study.md](native-emulation-case-study.md) for a real-world case study  
3. Customize the JNI and syscall implementations based on the characteristics of your target application
4. Use tools such as Frida to verify the accuracy of the Unidbg emulation results

Remember: the core of Unidbg is fully emulating the Android environment. The key to success lies in meticulously filling in all the APIs and environment characteristics required by the target application.