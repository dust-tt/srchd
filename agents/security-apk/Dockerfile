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
    file binutils binwalk upx-ucl \
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
    # Font libraries required by Ghidra headless analyzer
    libharfbuzz0b libfreetype6 fontconfig \
    # Additional dependencies for RE tools
    libcapstone-dev

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

# Create non-root user 'agent' with uid 1001
RUN groupadd -g 1001 agent && \
    useradd -u 1001 -g 1001 -m -s /bin/bash agent && \
    # Give agent sudo access (for permissive mode)
    echo 'agent ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

RUN mkdir -p /home/agent/.ssh && \
    chown -R agent:agent /home/agent/.ssh && \
    chmod 700 /home/agent/.ssh

# ============================================
# Android APK Analysis Tools
# ============================================

# Install Android SDK command-line tools
RUN mkdir -p /opt/android-sdk/cmdline-tools && \
    curl -L -o /tmp/cmdtools.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" && \
    unzip /tmp/cmdtools.zip -d /opt/android-sdk/cmdline-tools && \
    mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest && \
    rm /tmp/cmdtools.zip

ENV ANDROID_HOME=/opt/android-sdk \
    PATH=$PATH:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools

# Accept licenses and install platform tools (requires switching to root)
RUN yes | /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses && \
    /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager "platform-tools" "build-tools;34.0.0" && \
    chown -R agent:agent /opt/android-sdk

# Install APKTool
RUN mkdir -p /opt/apktool && \
    curl -L -o /opt/apktool/apktool.jar "https://github.com/iBotPeaches/Apktool/releases/download/v2.9.3/apktool_2.9.3.jar" && \
    curl -L -o /usr/local/bin/apktool "https://raw.githubusercontent.com/iBotPeaches/Apktool/master/scripts/linux/apktool" && \
    chmod +x /usr/local/bin/apktool && \
    sed -i "s|apktool.jar|/opt/apktool/apktool.jar|g" /usr/local/bin/apktool

# Install JADX
RUN mkdir -p /opt/jadx && \
    curl -L -o /tmp/jadx.zip "https://github.com/skylot/jadx/releases/download/v1.5.0/jadx-1.5.0.zip" && \
    unzip /tmp/jadx.zip -d /opt/jadx && \
    rm /tmp/jadx.zip && \
    chmod +x /opt/jadx/bin/jadx /opt/jadx/bin/jadx-gui && \
    ln -s /opt/jadx/bin/jadx /usr/local/bin/jadx && \
    ln -s /opt/jadx/bin/jadx-gui /usr/local/bin/jadx-gui

# Install dex2jar
RUN mkdir -p /opt/dex2jar && \
    curl -L -o /tmp/dex2jar.zip "https://github.com/pxb1988/dex2jar/releases/download/v2.4/dex-tools-v2.4.zip" && \
    unzip /tmp/dex2jar.zip -d /opt/dex2jar && \
    rm /tmp/dex2jar.zip && \
    chmod +x /opt/dex2jar/dex-tools-*/d2j-*.sh && \
    ln -s /opt/dex2jar/dex-tools-*/d2j-dex2jar.sh /usr/local/bin/d2j-dex2jar

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
    ropper \
    # Android-specific tools
    androguard \
    objection \
    pyaxmlparser

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

# Default command
CMD ["/bin/bash"]

# Metadata
LABEL maintainer="agent-computer" \
      description="Secure sandbox environment for apk reverse engineering research" \
      version="1.0"
