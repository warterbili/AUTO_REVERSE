#!/bin/bash
# APK rebuild and signing script
# Usage: ./rebuild_and_sign.sh <decoded_dir> [output.apk]

set -e

DECODED_DIR="$1"
OUTPUT_APK="$2"

if [ -z "$DECODED_DIR" ]; then
    echo "Usage: $0 <decoded_dir> [output.apk]"
    echo ""
    echo "Arguments:"
    echo "  decoded_dir  - directory produced by apktool decoding"
    echo "  output.apk   - output filename (optional, default: <dir_name>_signed.apk)"
    exit 1
fi

if [ ! -d "$DECODED_DIR" ]; then
    echo "Error: directory '$DECODED_DIR' does not exist"
    exit 1
fi

# Set the output filename
if [ -z "$OUTPUT_APK" ]; then
    DIR_NAME=$(basename "$DECODED_DIR")
    OUTPUT_APK="${DIR_NAME}_signed.apk"
fi

UNSIGNED_APK="${OUTPUT_APK%.apk}_unsigned.apk"
KEYSTORE_FILE="debug.keystore"
KEY_ALIAS="debug"
STORE_PASS="android"
KEY_PASS="android"

echo "========================================="
echo "APK rebuild and signing"
echo "========================================="

# Step 1: Rebuild the APK
echo ""
echo "[1/4] Rebuilding APK..."
apktool b "$DECODED_DIR" -f -o "$UNSIGNED_APK"

if [ ! -f "$UNSIGNED_APK" ]; then
    echo "Error: rebuild failed"
    exit 1
fi

# Step 2: Generate the debug keystore (if it does not exist)
echo ""
echo "[2/4] Checking/generating keystore..."
if [ ! -f "$KEYSTORE_FILE" ]; then
    echo "Generating debug keystore..."
    keytool -genkeypair \
        -alias "$KEY_ALIAS" \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -keystore "$KEYSTORE_FILE" \
        -storepass "$STORE_PASS" \
        -keypass "$KEY_PASS" \
        -dname "CN=Debug, OU=Debug, O=Debug, L=Debug, ST=Debug, C=US"
    echo "Keystore generated: $KEYSTORE_FILE"
else
    echo "Using existing keystore: $KEYSTORE_FILE"
fi

# Step 3: Sign the APK
echo ""
echo "[3/4] Signing APK..."

# Check whether apksigner is available (preferred)
if command -v apksigner &> /dev/null; then
    echo "Signing with apksigner..."
    apksigner sign \
        --ks "$KEYSTORE_FILE" \
        --ks-key-alias "$KEY_ALIAS" \
        --ks-pass "pass:$STORE_PASS" \
        --key-pass "pass:$KEY_PASS" \
        --out "$OUTPUT_APK" \
        "$UNSIGNED_APK"
elif command -v jarsigner &> /dev/null; then
    echo "Signing with jarsigner..."
    cp "$UNSIGNED_APK" "$OUTPUT_APK"
    jarsigner \
        -verbose \
        -sigalg SHA256withRSA \
        -digestalg SHA-256 \
        -keystore "$KEYSTORE_FILE" \
        -storepass "$STORE_PASS" \
        -keypass "$KEY_PASS" \
        "$OUTPUT_APK" \
        "$KEY_ALIAS"
else
    echo "Warning: no signing tool found (apksigner or jarsigner)"
    echo "Unsigned APK: $UNSIGNED_APK"
    exit 1
fi

# Step 4: Verify the signature
echo ""
echo "[4/4] Verifying signature..."
if command -v apksigner &> /dev/null; then
    apksigner verify --verbose "$OUTPUT_APK" 2>&1 | head -5
fi

# Clean up
rm -f "$UNSIGNED_APK"

echo ""
echo "========================================="
echo "Done!"
echo "Signed APK: $OUTPUT_APK"
echo "========================================="

# Show file size
ls -lh "$OUTPUT_APK" | awk '{print "File size: " $5}'
