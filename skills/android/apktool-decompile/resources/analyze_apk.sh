#!/bin/bash
# Quick APK analysis script
# Usage: ./analyze_apk.sh <apk_file>

set -e

APK_FILE="$1"
if [ -z "$APK_FILE" ]; then
    echo "Usage: $0 <apk_file>"
    exit 1
fi

if [ ! -f "$APK_FILE" ]; then
    echo "Error: file '$APK_FILE' does not exist"
    exit 1
fi

APK_NAME=$(basename "$APK_FILE" .apk)
OUTPUT_DIR="${APK_NAME}_decoded"

echo "========================================="
echo "APK analysis: $APK_FILE"
echo "========================================="

# Decode the APK
echo ""
echo "[1/5] Decoding APK..."
apktool d "$APK_FILE" -f -o "$OUTPUT_DIR"

# Show basic information
echo ""
echo "[2/5] Basic information:"
echo "-----------------------------------------"
if [ -f "$OUTPUT_DIR/apktool.yml" ]; then
    echo "APK version info:"
    grep -E "version|minSdkVersion|targetSdkVersion" "$OUTPUT_DIR/apktool.yml" 2>/dev/null || true
fi

# Analyze AndroidManifest.xml
echo ""
echo "[3/5] AndroidManifest.xml analysis:"
echo "-----------------------------------------"
if [ -f "$OUTPUT_DIR/AndroidManifest.xml" ]; then
    echo "Package name:"
    grep -oP 'package="\K[^"]+' "$OUTPUT_DIR/AndroidManifest.xml" 2>/dev/null || true

    echo ""
    echo "Permissions (first 10):"
    grep -oP 'android:name="\K[^"]+(?=.*permission)' "$OUTPUT_DIR/AndroidManifest.xml" 2>/dev/null | head -10 || true

    echo ""
    echo "Main Activity:"
    grep -B5 "android.intent.action.MAIN" "$OUTPUT_DIR/AndroidManifest.xml" 2>/dev/null | grep -oP 'android:name="\K[^"]+' | head -1 || true
fi

# Count smali files
echo ""
echo "[4/5] Smali code statistics:"
echo "-----------------------------------------"
for dir in "$OUTPUT_DIR"/smali*; do
    if [ -d "$dir" ]; then
        count=$(find "$dir" -name "*.smali" | wc -l | tr -d ' ')
        echo "$(basename "$dir"): $count classes"
    fi
done

# List native libraries
echo ""
echo "[5/5] Native libraries:"
echo "-----------------------------------------"
if [ -d "$OUTPUT_DIR/lib" ]; then
    for arch in "$OUTPUT_DIR/lib/"*; do
        if [ -d "$arch" ]; then
            echo "$(basename "$arch"):"
            ls -la "$arch"/*.so 2>/dev/null | awk '{print "  " $NF " (" $5 " bytes)"}' || echo "  (no .so files)"
        fi
    done
else
    echo "(no native libraries)"
fi

echo ""
echo "========================================="
echo "Decoding complete! Output directory: $OUTPUT_DIR"
echo "========================================="
