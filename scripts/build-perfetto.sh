#!/bin/bash

# Build Perfetto UI and Trace Processor for SmartPerfetto
# This script builds the necessary Perfetto components for integration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PERFETTO_DIR="../perfetto"
OUT_DIR="./out"
WASM_DIR="./public/wasm"
PERFETTO_UI_BUILD_DIR="./public/perfetto-ui"

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    # Check if we're in the right directory
    if [ ! -f "package.json" ]; then
        error "Please run this script from the SmartPerfetto root directory"
        exit 1
    fi

    # Check if Perfetto repo exists
    if [ ! -d "$PERFETTO_DIR" ]; then
        error "Perfetto repository not found at $PERFETTO_DIR"
        error "Please clone it first: git clone https://github.com/google/perfetto.git"
        exit 1
    fi

    # Check for Python (needed by Perfetto build)
    if ! command -v python3 &> /dev/null; then
        error "Python 3 is required"
        exit 1
    fi

    # Check for Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js is required"
        exit 1
    fi

    log "Prerequisites check completed"
}

# Build Perfetto Trace Processor (WASM)
build_trace_processor() {
    log "Building Perfetto Trace Processor (WASM)..."

    cd "$PERFETTO_DIR"

    # Create output directory
    mkdir -p out/wasm

    # Build with WASM support
    python3 tools/gn gen out/wasm --args='is_debug=false target_os="wasm"'
    python3 tools/ninja -C out/wasm trace_processor_wasm

    # Copy WASM files to SmartPerfetto
    cd "../SmartPerfetto"
    mkdir -p "$WASM_DIR"
    cp "$PERFETTO_DIR/out/wasm/trace_processor.wasm" "$WASM_DIR/"
    cp "$PERFETTO_DIR/out/wasm/trace_processor.js" "$WASM_DIR/"

    log "Trace Processor WASM build completed"
}

# Build Perfetto UI
build_ui() {
    log "Building Perfetto UI..."

    cd "$PERFETTO_DIR/ui"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        log "Installing UI dependencies..."
        ./npm ci
    fi

    # Build the UI
    log "Building UI bundle..."
    ./npm run build

    # Copy built UI to SmartPerfetto
    cd "../SmartPerfetto"
    mkdir -p "$PERFETTO_UI_BUILD_DIR"

    # Copy only the necessary files from the build
    cp -r "$PERFETTO_DIR/ui/out/dist/"* "$PERFETTO_UI_BUILD_DIR/"

    # Copy trace_processor.wasm and JS for embedded use
    mkdir -p "$PERFETTO_UI_BUILD_DIR/wasm"
    cp "$WASM_DIR/trace_processor.wasm" "$PERFETTO_UI_BUILD_DIR/wasm/"
    cp "$WASM_DIR/trace_processor.js" "$PERFETTO_UI_BUILD_DIR/wasm/"

    log "Perfetto UI build completed"
}

# Update package.json with Perfetto dependencies
update_dependencies() {
    log "Updating package.json with Perfetto dependencies..."

    # Update .env.example with Perfetto paths
    if ! grep -q "PERFETTO_UI_URL" .env.example; then
        echo "" >> .env.example
        echo "# Perfetto Integration" >> .env.example
        echo "PERFETTO_UI_URL=https://ui.perfetto.dev/v3.1/perfetto.js" >> .env.example
        echo "PERFETTO_WASM_URL=/wasm/trace_processor.js" >> .env.example
    fi

    log "Dependencies updated"
}

# Create Perfetto integration docs
create_integration_docs() {
    log "Creating integration documentation..."

    mkdir -p docs

    cat > docs/PERFETTO_INTEGRATION.md << 'EOF'
# Perfetto Integration Guide

This document explains how SmartPerfetto integrates with the official Perfetto UI and Trace Processor.

## Architecture

### Components

1. **Perfetto UI Embed** (`src/components/PerfettoUI/PerfettoUIEmbed.tsx`)
   - Embeds the official Perfetto UI using the script from ui.perfetto.dev
   - Extends functionality with AI-powered features
   - Handles authentication and subscription checks
   - Provides custom analysis shortcuts

2. **Perfetto Service** (`backend/src/services/perfettoService.ts`)
   - Integrates with the actual Perfetto Trace Processor
   - Executes SQL queries on trace files
   - Provides performance analysis functions
   - Handles trace conversion and metadata

3. **AI Service Updates** (`backend/src/services/aiService.ts`)
   - Updated with official Perfetto SQL table schemas
   - Includes all 14+ official tables and their columns
   - Provides built-in functions and macros
   - Contains example queries for common analyses

### Key Features

#### 1. Official SQL Tables
All official Perfetto tables are supported:

- **slice**: User space slices
- **thread**: Thread information
- **process**: Process information
- **sched**: Kernel scheduling
- **counter**: Time-series counters
- **ftrace_event**: Kernel ftrace events
- And more...

#### 2. Built-in Functions
- `EXTRACT_ARG()` - Extract event arguments
- `SPAN_JOIN()` - Join time intervals
- `ANDROID_*()` macros - Android-specific helpers

#### 3. AI-Powered Query Generation
The AI service knows about:
- All table schemas
- Common query patterns
- Performance analysis techniques
- Best practices

## Building from Source

### Prerequisites
- Python 3.8+
- Node.js 18+
- Git

### Build Steps

```bash
# 1. Clone Perfetto (already done)
git clone https://github.com/google/perfetto.git

# 2. Build components
./scripts/build-perfetto.sh
```

### What Gets Built
1. **Trace Processor WASM** - For embedded SQL execution
2. **UI Bundle** - Customized Perfetto UI with our extensions
3. **Integration Files** - Required for deployment

## Deployment

### Option 1: Use CDN (Recommended)
- Uses Perfetto's hosted JS file
- No need to build locally
- Always up-to-date

### Option 2: Self-hosted
- Build locally using the script
- Host UI files on your server
- Full control over versions

## Customization

### Adding New Analysis Types
1. Update `perfettoService.ts` with new queries
2. Add UI shortcuts in `PerfettoUIEmbed.tsx`
3. Update AI service with new patterns

### Extending the UI
The Perfetto UI can be extended using:
- Custom plugins
- Additional sidebar sections
- Custom query editor actions
- Export functionality

## Testing

```bash
# Test WASM build
node -e "require('./public/wasm/trace_processor.js')"

# Test UI build
curl -I http://localhost:3000/perfetto-ui/
```

## Troubleshooting

### Common Issues
1. **Build fails**: Check Python and Node versions
2. **WASM errors**: Ensure Emscripten is properly configured
3. **UI loading**: Check CORS headers and paths

### Debug Mode
Build with debug enabled:
```bash
cd perfetto
python3 tools/gn gen out/wasm_debug --args='is_debug=true'
python3 tools/ninja -C out/wasm_debug trace_processor_wasm
```
EOF

    log "Integration documentation created"
}

# Verify build
verify_build() {
    log "Verifying build..."

    # Check WASM files
    if [ ! -f "$WASM_DIR/trace_processor.wasm" ]; then
        error "trace_processor.wasm not found"
        exit 1
    fi

    # Check UI build
    if [ ! -f "$PERFETTO_UI_BUILD_DIR/index.html" ]; then
        error "Perfetto UI build not found"
        exit 1
    fi

    log "Build verification successful"
}

# Main script
main() {
    log "Starting Perfetto build process..."

    check_prerequisites
    build_trace_processor
    build_ui
    update_dependencies
    create_integration_docs
    verify_build

    log "Perfetto build process completed successfully!"
    log ""
    log "Next steps:"
    log "1. Start the development server: npm run dev"
    log "2. Test the integration by uploading a trace file"
    log "3. Check the Perfetto UI loads correctly"
}

# Handle script interruption
trap 'error "Build interrupted"; exit 1' INT

# Run main function
main "$@"