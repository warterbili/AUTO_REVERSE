# Unidbg Common Issues and Solutions

This document compiles common issues encountered when using Unidbg along with their solutions, based on hands-on project experience.

## Environment Setup Issues

### 1. Dependency Version Conflicts

**Problem**: Maven dependency conflicts prevent the project from compiling

```
[ERROR] Failed to execute goal on project: Could not resolve dependencies for project...
```

**Solution**:
```xml
<!-- Explicitly pin versions in pom.xml -->
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.github.zhkl0228</groupId>
            <artifactId>unidbg-android</artifactId>
            <version>0.9.9-SNAPSHOT</version>
        </dependency>
        <dependency>
            <groupId>org.slf4j</groupId>
            <artifactId>slf4j-api</artifactId>
            <version>2.0.16</version>
        </dependency>
    </dependencies>
</dependencyManagement>

<!-- Exclude conflicting dependencies -->
<dependency>
    <groupId>com.github.zhkl0228</groupId>
    <artifactId>unidbg-android</artifactId>
    <exclusions>
        <exclusion>
            <groupId>org.slf4j</groupId>
            <artifactId>slf4j-log4j12</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```

### 2. Incompatible JDK Version

**Problem**: Module system errors occur when using JDK 17+

```
java.lang.reflect.InaccessibleObjectException: Unable to make field accessible
```

**Solution**:
```bash
# Option 1: Use JDK 8
export JAVA_HOME=/path/to/jdk8

# Option 2: Add JVM arguments (JDK 9+)
java --add-opens java.base/java.lang=ALL-UNNAMED \
     --add-opens java.base/java.lang.reflect=ALL-UNNAMED \
     --add-opens java.base/sun.nio.ch=ALL-UNNAMED \
     -jar your-app.jar
```

### 3. Missing rootfs File System

**Problem**: The emulator cannot find system libraries on startup

```
java.io.FileNotFoundException: /android_system/lib64/libc.so
```

**Solution**:
```bash
# Create the complete rootfs structure
mkdir -p rootfs/system/{lib,lib64,bin,etc}
mkdir -p rootfs/data/user/0
mkdir -p rootfs/proc
mkdir -p rootfs/dev
mkdir -p rootfs/vendor/{lib,lib64}

# Extract system libraries from a real device or emulator
adb pull /system/lib rootfs/system/
adb pull /system/lib64 rootfs/system/
```

## Library Loading Issues

### 1. SO Library Fails to Load

**Problem**: The target library cannot be loaded correctly

```
java.lang.UnsatisfiedLinkError: can't find native method
```

**Solution**:
```java
// Check the library file's architecture
public void checkLibraryArch(String libPath) {
    try (RandomAccessFile raf = new RandomAccessFile(libPath, "r")) {
        byte[] header = new byte[20];
        raf.read(header);
        
        // ELF header check
        if (header[4] == 1) {
            System.out.println("32-bit library");
            // Use a 32-bit emulator
        } else if (header[4] == 2) {
            System.out.println("64-bit library");
            // Use a 64-bit emulator
        }
    }
}

// Force-load dependency libraries
vm.loadLibrary("libc");
vm.loadLibrary("libm");
vm.loadLibrary("libdl");
// Then load the target library
DalvikModule dm = vm.loadLibrary("target_lib", true);
```

### 2. Symbol Resolution Failure

**Problem**: A function symbol cannot be found

```
java.lang.IllegalStateException: find symbol failed: function_name
```

**Solution**:
```java
// Option 1: Call by address offset
long functionOffset = 0x12345; // Obtained from IDA or another tool
Number result = module.callFunction(emulator, functionOffset, args);

// Option 2: Search for a function pattern
public long findFunctionByPattern(Module module, byte[] pattern) {
    Backend backend = emulator.getBackend();
    byte[] data = backend.mem_read(module.base, (int) module.size);
    
    for (int i = 0; i <= data.length - pattern.length; i++) {
        if (Arrays.equals(Arrays.copyOfRange(data, i, i + pattern.length), pattern)) {
            return module.base + i;
        }
    }
    return 0;
}

// Option 3: Resolve the symbol table dynamically
ElfFile elfFile = ElfFile.fromBytes(Files.readAllBytes(Paths.get(libPath)));
for (ElfSymbol symbol : elfFile.getDynamicSymbolTable()) {
    if ("target_function".equals(symbol.getName())) {
        long address = module.base + symbol.value;
        // Call by address
    }
}
```

## JNI Implementation Issues

### 1. Incorrect JNI Method Signature

**Problem**: Argument types do not match during a method call

```
java.lang.IllegalArgumentException: wrong number of arguments
```

**Solution**:
```java
// Parse the method signature correctly
public class JniSignatureHelper {
    public static String[] parseSignature(String signature) {
        // Example: (Ljava/lang/String;I)Ljava/lang/String;
        // Parameters: String, int
        // Return: String
        
        String params = signature.substring(1, signature.indexOf(')'));
        List<String> paramTypes = new ArrayList<>();
        
        int i = 0;
        while (i < params.length()) {
            switch (params.charAt(i)) {
                case 'L':
                    int end = params.indexOf(';', i);
                    paramTypes.add(params.substring(i, end + 1));
                    i = end + 1;
                    break;
                case '[':
                    // Handle array types
                    int start = i;
                    while (params.charAt(i) == '[') i++;
                    if (params.charAt(i) == 'L') {
                        i = params.indexOf(';', i) + 1;
                    } else {
                        i++;
                    }
                    paramTypes.add(params.substring(start, i));
                    break;
                default:
                    // Primitive type
                    paramTypes.add(String.valueOf(params.charAt(i)));
                    i++;
                    break;
            }
        }
        
        return paramTypes.toArray(new String[0]);
    }
}
```

### 2. Object Type Cast Errors

**Problem**: A DvmObject type cast fails

```java
java.lang.ClassCastException: Cannot cast StringObject to IntObject
```

**Solution**:
```java
// Safe type casting
@Override
public DvmObject<?> callObjectMethod(BaseVM vm, DvmObject<?> dvmObject, DvmMethod dvmMethod, VarArg varArg) {
    String signature = dvmObject.getObjectType() + "->" + dvmMethod.getMethodName() + dvmMethod.getSignature();
    
    switch (signature) {
        case "java/lang/Object->toString()Ljava/lang/String;":
            // Safely handle a toString call on an arbitrary object
            Object value = dvmObject.getValue();
            return new StringObject(vm, value != null ? value.toString() : "null");
            
        case "java/lang/Integer->intValue()I":
            // Ensure the object type is correct
            if (dvmObject instanceof DvmInteger) {
                return DvmInteger.valueOf(vm, ((Number) dvmObject.getValue()).intValue());
            } else {
                // Attempt conversion
                try {
                    int value = Integer.parseInt(dvmObject.getValue().toString());
                    return DvmInteger.valueOf(vm, value);
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("Cannot convert to integer: " + dvmObject.getValue());
                }
            }
    }
    
    return super.callObjectMethod(vm, dvmObject, dvmMethod, varArg);
}
```

### 3. Array Handling Issues

**Problem**: Array arguments are passed incorrectly

```java
// Create and pass arrays correctly
public ArrayObject createStringArray(VM vm, String[] strings) {
    DvmObject<?>[] array = new DvmObject<?>[strings.length];
    for (int i = 0; i < strings.length; i++) {
        array[i] = new StringObject(vm, strings[i]);
    }
    return new ArrayObject(array);
}

// Use it in a JNI call
List<Object> args = new ArrayList<>();
args.add(vm.getJNIEnv());
args.add(vm.addLocalObject(thiz));
args.add(vm.addLocalObject(createStringArray(vm, new String[]{"arg1", "arg2"})));
```

## System Call Issues

### 1. File Access Permissions

**Problem**: Insufficient permissions on the emulated file system

```
java.io.FileNotFoundException: /proc/version (Permission denied)
```

**Solution**:
```java
@Override
protected int open(Emulator<?> emulator, String pathname, int flags) {
    // Intercept access to sensitive files
    switch (pathname) {
        case "/proc/version":
            return createFileIO("Linux version 4.4.0-android");
        case "/proc/cpuinfo":
            return createFileIO(generateCpuInfo());
        case "/system/build.prop":
            return createFileIO(generateBuildProp());
        default:
            return super.open(emulator, pathname, flags);
    }
}

private int createFileIO(String content) {
    ByteArrayFileIO fileIO = new ByteArrayFileIO(0, "virtual_file", content.getBytes());
    return addFileIO(fileIO);
}
```

### 2. Network Operation Emulation

**Problem**: Network system calls are not implemented

```java
@Override
protected int socket(Emulator<?> emulator, int domain, int type, int protocol) {
    // Emulate socket creation
    if (domain == AF_INET && type == SOCK_STREAM) {
        // Create a virtual TCP socket
        return createVirtualSocket();
    }
    return super.socket(emulator, domain, type, protocol);
}

@Override
protected int connect(Emulator<?> emulator, int sockfd, Pointer addr, int addrlen) {
    // Emulate a successful connection
    return 0;
}

@Override
protected int send(Emulator<?> emulator, int sockfd, Pointer buf, int len, int flags) {
    // Log the data being sent
    byte[] data = buf.getByteArray(0, len);
    System.out.println("Send data: " + new String(data));
    return len; // Emulate sending everything successfully
}
```

## Memory Management Issues

### 1. Memory Leaks

**Problem**: Memory usage becomes excessive after running for a long time

**Solution**:
```java
public class MemoryManager {
    private final Set<UnidbgPointer> allocatedMemory = new HashSet<>();
    
    public UnidbgPointer allocate(int size) {
        UnidbgPointer ptr = emulator.getMemory().mmap(size, 
            UnicornConst.UC_PROT_READ | UnicornConst.UC_PROT_WRITE);
        allocatedMemory.add(ptr);
        return ptr;
    }
    
    public void cleanup() {
        for (UnidbgPointer ptr : allocatedMemory) {
            try {
                emulator.getMemory().munmap(ptr.peer, ptr.getSize());
            } catch (Exception e) {
                // Ignore cleanup errors
            }
        }
        allocatedMemory.clear();
    }
}

// Invoke cleanup at the appropriate time
@Override
public void destroy() throws IOException {
    memoryManager.cleanup();
    super.destroy();
}
```

### 2. Stack Overflow

**Problem**: Recursive calls cause a stack overflow

```java
// Set a larger stack size
emulator.getMemory().setStackPoint(0x40000000L);

// Check stack usage
public void checkStackUsage() {
    long sp = emulator.getContext().getStackPointer();
    long stackBase = emulator.getMemory().getStackBase();
    long used = stackBase - sp;
    System.out.println("Stack used: " + used + " bytes");
    
    if (used > 0x100000) { // 1MB
        System.warn("High stack usage detected");
    }
}
```

## Debugging and Diagnostics

### 1. Enable Verbose Logging

```java
// logback.xml configuration
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>
    
    <!-- Unidbg-related loggers -->
    <logger name="com.github.unidbg" level="DEBUG"/>
    <logger name="com.github.unidbg.arm" level="INFO"/>
    <logger name="com.github.unidbg.linux" level="DEBUG"/>
    
    <root level="INFO">
        <appender-ref ref="STDOUT"/>
    </root>
</configuration>
```

### 2. Performance Monitoring

```java
public class PerformanceMonitor {
    private long startTime;
    private final Map<String, Long> timings = new HashMap<>();
    
    public void startTiming(String operation) {
        startTime = System.nanoTime();
    }
    
    public void endTiming(String operation) {
        long elapsed = System.nanoTime() - startTime;
        timings.put(operation, elapsed);
        System.out.println(operation + ": " + elapsed / 1000000 + " ms");
    }
    
    public void printReport() {
        System.out.println("Performance Report:");
        timings.entrySet().stream()
            .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
            .forEach(e -> System.out.println("  " + e.getKey() + ": " + e.getValue() / 1000000 + " ms"));
    }
}
```

### 3. Exception Tracing

```java
public class ExceptionHandler {
    public static void setupExceptionHandling(AndroidEmulator emulator) {
        // Set up the exception handler
        emulator.getBackend().hook_add_new(new CodeHook() {
            @Override
            public void hook(Backend backend, long address, int size, Object user) {
                try {
                    // Normal execution
                } catch (Exception e) {
                    System.err.println("Exception at address: 0x" + Long.toHexString(address));
                    e.printStackTrace();
                    
                    // Print register state
                    emulator.showRegs();
                    
                    // Print memory contents
                    byte[] memory = backend.mem_read(address - 0x100, 0x200);
                    Inspector.inspect(memory, "Memory around exception");
                }
            }
        }, 0, -1, null);
    }
}
```

## Best Practice Recommendations

### 1. Incremental Implementation

```java
// Start simple and refine progressively
public class ProgressiveImplementation extends AbstractJni {
    private final Set<String> unimplementedMethods = new HashSet<>();
    
    @Override
    public DvmObject<?> callObjectMethod(BaseVM vm, DvmObject<?> dvmObject, DvmMethod dvmMethod, VarArg varArg) {
        String signature = dvmObject.getObjectType() + "->" + dvmMethod.getMethodName() + dvmMethod.getSignature();
        
        // Record unimplemented methods
        if (!unimplementedMethods.contains(signature)) {
            unimplementedMethods.add(signature);
            System.out.println("TODO: Implement " + signature);
        }
        
        // Return a safe default value
        return getDefaultReturnValue(vm, signature);
    }
    
    private DvmObject<?> getDefaultReturnValue(BaseVM vm, String signature) {
        if (signature.endsWith("Ljava/lang/String;")) {
            return new StringObject(vm, "");
        } else if (signature.endsWith(")I")) {
            return DvmInteger.valueOf(vm, 0);
        } else if (signature.endsWith(")Z")) {
            return DvmBoolean.valueOf(vm, false);
        }
        return null;
    }
    
    public void printUnimplementedMethods() {
        System.out.println("Unimplemented methods (" + unimplementedMethods.size() + "):");
        unimplementedMethods.forEach(System.out::println);
    }
}
```

### 2. Modular Design

```java
// Separate different responsibilities into different classes
public class AndroidEmulationFramework {
    private final SystemCallHandler syscallHandler;
    private final JniImplementation jniImpl;
    private final MemoryManager memoryManager;
    private final HookManager hookManager;
    
    public AndroidEmulationFramework() {
        this.syscallHandler = new CustomSyscallHandler();
        this.jniImpl = new CustomJniImplementation();
        this.memoryManager = new MemoryManager();
        this.hookManager = new HookManager();
    }
    
    public void setupEmulation(AndroidEmulator emulator) {
        syscallHandler.register(emulator);
        jniImpl.register(emulator.createDalvikVM());
        hookManager.setupHooks(emulator);
    }
}
```

### 3. Test Validation

```java
public class EmulationValidator {
    public void validateEmulation(AndroidEmulator emulator, String expectedOutput) {
        // Run the test case
        String actualOutput = runTestCase(emulator);
        
        // Compare the results
        if (!expectedOutput.equals(actualOutput)) {
            System.err.println("Validation failed!");
            System.err.println("Expected: " + expectedOutput);
            System.err.println("Actual: " + actualOutput);
            
            // Generate a detailed diff report
            generateDiffReport(expectedOutput, actualOutput);
        } else {
            System.out.println("Validation passed!");
        }
    }
}
```

Remember: Debugging with Unidbg is an iterative process that requires continuously analyzing errors, filling in the environment, and validating results. Stay patient and refine your emulation implementation step by step.