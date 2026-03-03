# Dockerfile for agent-computer:security-macos
# Provides a secure, isolated environment for macOS application reverse engineering research

FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install essential packages and development tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core utilities
    sudo bash coreutils findutils grep sed gawk \
    ca-certificates curl wget git vim nano less fd-find \
    # Process and system tools
    htop tmux screen psmisc procps \
    # Development tools
    build-essential gcc g++ make cmake \
    # Python ecosystem
    python3 python3-pip python3-venv python3-dev \
    # Node.js ecosystem
    nodejs npm \
    # Network tools
    netcat-openbsd iputils-ping dnsutils openssh-client \
    # Archive tools
    zip unzip tar gzip p7zip-full \
    # Text processing
    jq xmlstarlet \
    # Search Tools
    ripgrep \
    # RE tools - debugging and tracing
    gdb gdb-multiarch ltrace strace valgrind \
    # RE tools - binary analysis
    file binutils binwalk upx-ucl \
    # RE tools - hex inspection
    xxd \
    # RE tools - fuzzing
    afl++ \
    # Qemu for emulation
    qemu-system qemu-user qemu-user-static \
    # Java runtime for Ghidra
    openjdk-21-jdk-headless \
    # Font libraries required by Ghidra headless analyzer
    libharfbuzz0b libfreetype6 fontconfig \
    # Additional dependencies for RE tools
    libcapstone-dev \
    # SQLite tools (for analyzing app databases)
    sqlite3 libsqlite3-dev \
    # DMG and HFS+ support
    hfsprogs libplist-utils \
    # For plist parsing
    libxml2-utils

# Install radare2 from source (latest version)
# Note: sys/install.sh creates symlinks to the source directory, so we keep it
RUN git clone --depth 1 https://github.com/radareorg/radare2 /opt/radare2 && \
    cd /opt/radare2 && sys/install.sh

# Install Ghidra (headless)
RUN mkdir -p /opt/ghidra && \
    curl -L -o /tmp/ghidra.zip "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_11.2.1_build/ghidra_11.2.1_PUBLIC_20241105.zip" && \
    unzip /tmp/ghidra.zip -d /opt/ghidra && \
    rm /tmp/ghidra.zip && \
    ln -s /opt/ghidra/ghidra_11.2.1_PUBLIC /opt/ghidra/latest && \
    ln -s /opt/ghidra/latest/support/analyzeHeadless /usr/local/bin/analyzeHeadless

# ============================================
# macOS Binary Analysis Tools
# ============================================

# Note: macOS-native tools (otool, lipo, class-dump, codesign, jtool2) are macOS-only binaries.
# On Linux we use cross-platform alternatives:
#   - LIEF (Python) for Mach-O parsing, header inspection, entitlements, symbols (replaces otool, lipo, codesign)
#   - Ghidra headless for decompilation of arm64/x86_64 Mach-O binaries
#   - radare2 for disassembly and analysis of Mach-O binaries
#   - macholib (Python) for Mach-O structure inspection
#   - Custom helper scripts (macho-info, plutil-linux) installed below
# p7zip-full (installed above) handles DMG extraction via 7z

# Create non-root user 'agent' with uid 1001
RUN groupadd -g 1001 agent && \
    useradd -u 1001 -g 1001 -m -s /bin/bash agent && \
    # Give agent sudo access (for permissive mode)
    echo 'agent ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

RUN mkdir -p /home/agent/.ssh && \
    chown -R agent:agent /home/agent/.ssh && \
    chmod 700 /home/agent/.ssh

USER agent
# IDENTITY_FILES_COPY_PLACEHOLDER
WORKDIR /home/agent

RUN ssh-keyscan github.com >> /home/agent/.ssh/known_hosts

# Install asar globally (for extracting Electron app ASAR archives)
RUN npm install -g @electron/asar 2>/dev/null || sudo npm install -g @electron/asar

# Create Python virtual environment and install RE packages
RUN python3 -m venv /home/agent/.venv && \
    /home/agent/.venv/bin/pip install --upgrade pip && \
    /home/agent/.venv/bin/pip install \
    # Data science and analysis
    numpy pandas matplotlib \
    # Web and API tools
    requests httpx beautifulsoup4 \
    # RE Python tools - core
    r2pipe \
    frida-tools frida \
    pwntools \
    # RE Python tools - disassembly/assembly
    capstone \
    keystone-engine \
    # RE Python tools - emulation
    unicorn \
    # RE Python tools - symbolic execution
    angr \
    # RE Python tools - binary parsing (ELF and Mach-O)
    pyelftools \
    lief \
    # RE Python tools - Mach-O specific
    macholib \
    # RE Python tools - crypto
    pycryptodome \
    # RE Python tools - plist parsing (for macOS Info.plist, entitlements)
    biplist \
    # Utilities
    ropper

# Configure shell environment (use .profile for login shells, .bashrc for interactive)
RUN echo 'export PATH="/home/agent/.venv/bin:/opt/ghidra/latest/support:/usr/local/bin:$PATH"' >> /home/agent/.profile && \
    echo 'export PYTHONPATH="/home/agent:$PYTHONPATH"' >> /home/agent/.profile && \
    echo 'export GHIDRA_INSTALL_DIR="/opt/ghidra/latest"' >> /home/agent/.profile && \
    echo 'export PATH="/home/agent/.venv/bin:/opt/ghidra/latest/support:/usr/local/bin:$PATH"' >> /home/agent/.bashrc && \
    echo 'export PYTHONPATH="/home/agent:$PYTHONPATH"' >> /home/agent/.bashrc && \
    echo 'export GHIDRA_INSTALL_DIR="/opt/ghidra/latest"' >> /home/agent/.bashrc && \
    echo 'alias ll="ls -la"' >> /home/agent/.bashrc && \
    echo 'alias la="ls -la"' >> /home/agent/.bashrc && \
    echo 'alias r2="radare2"' >> /home/agent/.bashrc && \
    echo 'cd /home/agent' >> /home/agent/.bashrc

# Create directory for GDB command files
RUN mkdir -p /home/agent/.gdb && \
    echo 'set disassembly-flavor intel' >> /home/agent/.gdbinit && \
    echo 'set pagination off' >> /home/agent/.gdbinit

# Create helper script for plist parsing (plutil equivalent for Linux)
RUN cat > /home/agent/.venv/bin/plutil-linux << 'SCRIPT'
#!/usr/bin/env python3
"""plutil equivalent for Linux - parse Apple plist files."""
import sys, json, plistlib
if len(sys.argv) < 2:
    print("Usage: plutil-linux <file.plist>")
    sys.exit(1)
with open(sys.argv[1], 'rb') as f:
    data = plistlib.load(f)
print(json.dumps(data, indent=2, default=str))
SCRIPT
RUN chmod +x /home/agent/.venv/bin/plutil-linux

# Create helper script for Mach-O inspection (otool alternative using lief)
RUN cat > /home/agent/.venv/bin/macho-info << 'SCRIPT'
#!/usr/bin/env python3
"""Mach-O binary inspector using LIEF (otool alternative for Linux)."""
import sys, lief
if len(sys.argv) < 2:
    print("Usage: macho-info <binary> [--libs|--headers|--symbols|--entitlements]")
    sys.exit(1)
binary = lief.parse(sys.argv[1])
if binary is None:
    print(f"Error: Cannot parse {sys.argv[1]}")
    sys.exit(1)
mode = sys.argv[2] if len(sys.argv) > 2 else "--headers"
if mode == "--libs":
    for lib in binary.libraries:
        print(f"  {lib.name} (compat: {lib.compatibility_version}, current: {lib.current_version})")
elif mode == "--headers":
    print(f"Magic: {binary.header.magic}")
    print(f"CPU Type: {binary.header.cpu_type}")
    print(f"File Type: {binary.header.file_type}")
    print(f"Flags: {binary.header.flags}")
    print(f"Number of commands: {binary.header.nb_cmds}")
elif mode == "--symbols":
    for sym in list(binary.symbols)[:200]:
        print(f"  {sym.name}")
elif mode == "--entitlements":
    if binary.code_signature:
        print(f"Code signature size: {binary.code_signature.data_size}")
    # Try to extract entitlements from code signature
    for cmd in binary.commands:
        if hasattr(cmd, 'data') and b'<!DOCTYPE plist' in getattr(cmd, 'data', b''):
            print(cmd.data.decode('utf-8', errors='ignore'))
else:
    print(f"Unknown mode: {mode}")
SCRIPT
RUN chmod +x /home/agent/.venv/bin/macho-info

# Default command
CMD ["/bin/bash"]

# Metadata
LABEL maintainer="agent-computer" \
      description="Secure sandbox environment for macOS application reverse engineering research" \
      version="1.0"
