# Dockerfile for agent-computer:security-reverse
# Provides a secure, isolated environment for reverse engineering research

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
    zip unzip tar gzip \
    # Text processing
    jq xmlstarlet \
    # Search Tools
    ripgrep \
    # RE tools - debugging and tracing
    gdb gdb-multiarch ltrace strace valgrind \
    # RE tools - binary analysis
    binutils binwalk upx-ucl \
    # RE tools - hex inspection
    xxd \
    # RE tools - fuzzing
    afl++ \
    # Multi-architecture support
    gcc-multilib g++-multilib \
    libc6-dev-i386 \
    # Qemu for emulation
    qemu-system qemu-user qemu-user-static \
    # Java runtime for Ghidra
    openjdk-21-jdk-headless \
    # Additional dependencies for RE tools
    libcapstone-dev

# Install radare2 from source (latest version)
RUN git clone --depth 1 https://github.com/radareorg/radare2 /tmp/radare2 && \
    cd /tmp/radare2 && sys/install.sh && \
    rm -rf /tmp/radare2

# Install Ghidra (headless)
RUN mkdir -p /opt/ghidra && \
    curl -L -o /tmp/ghidra.zip "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_11.2.1_build/ghidra_11.2.1_PUBLIC_20241105.zip" && \
    unzip /tmp/ghidra.zip -d /opt/ghidra && \
    rm /tmp/ghidra.zip && \
    ln -s /opt/ghidra/ghidra_11.2.1_PUBLIC /opt/ghidra/latest && \
    ln -s /opt/ghidra/latest/support/analyzeHeadless /usr/local/bin/analyzeHeadless

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
    # RE Python tools - binary parsing
    pyelftools \
    lief \
    # RE Python tools - crypto
    pycryptodome \
    # Utilities
    ropper

# Configure shell environment
RUN echo 'export PATH="/home/agent/.venv/bin:/opt/ghidra/latest/support:$PATH"' >> /home/agent/.bashrc && \
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

# Default command
CMD ["/bin/bash"]

# Metadata
LABEL maintainer="agent-computer" \
      description="Secure sandbox environment for reverse engineering research" \
      version="1.0"
