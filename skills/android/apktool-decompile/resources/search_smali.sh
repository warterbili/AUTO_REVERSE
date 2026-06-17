#!/bin/bash
# Smali code search script
# Usage: ./search_smali.sh <decoded_dir> <search_pattern> [options]

DECODED_DIR="$1"
PATTERN="$2"
shift 2

if [ -z "$DECODED_DIR" ] || [ -z "$PATTERN" ]; then
    echo "Usage: $0 <decoded_dir> <search_pattern> [options]"
    echo ""
    echo "Options:"
    echo "  -m, --methods    search method definitions only"
    echo "  -c, --classes    search class definitions only"
    echo "  -s, --strings    search string constants only"
    echo "  -n, --native     search native methods only"
    echo "  -i, --ignore     ignore case"
    echo ""
    echo "Examples:"
    echo "  $0 app_decoded 'signature'"
    echo "  $0 app_decoded 'encrypt' -m"
    echo "  $0 app_decoded 'api_key' -s"
    exit 1
fi

if [ ! -d "$DECODED_DIR" ]; then
    echo "Error: directory '$DECODED_DIR' does not exist"
    exit 1
fi

# Parse options
GREP_OPTS=""
EXTRA_PATTERN=""
SEARCH_TYPE="all"

while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--methods)
            SEARCH_TYPE="methods"
            EXTRA_PATTERN=".method"
            shift
            ;;
        -c|--classes)
            SEARCH_TYPE="classes"
            EXTRA_PATTERN=".class"
            shift
            ;;
        -s|--strings)
            SEARCH_TYPE="strings"
            EXTRA_PATTERN="const-string"
            shift
            ;;
        -n|--native)
            SEARCH_TYPE="native"
            EXTRA_PATTERN="native"
            shift
            ;;
        -i|--ignore)
            GREP_OPTS="-i"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

echo "========================================="
echo "Smali search: $PATTERN"
echo "Search type: $SEARCH_TYPE"
echo "Directory: $DECODED_DIR"
echo "========================================="
echo ""

# Run the search
if [ "$SEARCH_TYPE" = "all" ]; then
    # Plain search
    grep -rn $GREP_OPTS "$PATTERN" "$DECODED_DIR"/smali* 2>/dev/null | head -100
else
    # Search with an additional pattern
    grep -rn $GREP_OPTS "$EXTRA_PATTERN" "$DECODED_DIR"/smali* 2>/dev/null | grep $GREP_OPTS "$PATTERN" | head -100
fi

# Count results
echo ""
echo "-----------------------------------------"
TOTAL=$(grep -rn $GREP_OPTS "$PATTERN" "$DECODED_DIR"/smali* 2>/dev/null | wc -l | tr -d ' ')
echo "Total matches: $TOTAL"

if [ "$TOTAL" -gt 100 ]; then
    echo "(showing first 100 results only)"
fi
