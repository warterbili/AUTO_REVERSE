---
name: jadx-reverse-engineering
description: Patterns and workflows for using JADX MCP to reverse engineer Android applications.
---

# JADX Reverse Engineering Skill

This skill documents effective patterns for navigating and analyzing Android codebases using the JADX MCP server.

## Core Workflows

### 1. Initial Exploration
- **Step 1**: Get `AndroidManifest.xml` to find the package name and main activities.
  - Tool: `get_android_manifest()`
- **Step 2**: List main application classes.
  - Tool: `get_main_application_classes_names()`
- **Step 3**: Identify key interceptors or entry points (e.g., OkHttp interceptors).
  - Tool: `search_classes_by_keyword(search_term="Interceptor")`

### 2. Source Analysis
- View class source to understand logic.
  - Tool: `get_class_source(class_name="com.example.TargetClass")`
- List methods/fields of a class.
  - Tools: `get_methods_of_class()`, `get_fields_of_class()`

### 3. Cross-Reference (XRef) Tracing
- Trace where a method is called or where a class is instantiated.
  - Tools: `get_xrefs_to_method()`, `get_xrefs_to_class()`
- Find where a field is accessed.
  - Tool: `get_xrefs_to_field()`

### 4. Handling Obfuscation
- **Method Discovery**: If a class name is known but methods are renamed, list all methods to find the one with matching signature/logic.
- **Reverse Tracing**: If you reach a native boundary, use `RegisterNatives` hooks in Frida to map obfuscated Java methods to Native offsets.
- **Object Inspection**: Use Frida to dump fields of obfuscated objects (like `AppInfo`) using reflection.

## Example Patterns

### Tracing a Header Generation
1. Find the Interceptor class.
2. Read the `intercept` method source.
3. Identify the helper method calculating the header.
4. If it's an interface call, use `get_xrefs_to_class` on the interface to find its implementations.
5. Locate the native method call.

## Best Practices
- **Pagination**: Most listing tools support `offset` and `count`. Use them for large codebases.
- **Absolute Paths**: When referencing files in JADX, always use the fully qualified class name.
- **Combined Analysis**: Use JADX MCP to find *what* is called, and Native analysis (IDA/Frida) to find *how* it's calculated.
