# Dockerfile for agent-computer:base
# Provides a secure, isolated environment for AI agents to execute code

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
    # Archive tools
    zip unzip tar gzip \
    # Text processing
    jq xmlstarlet \
    # Search Tools
    ripgrep \
    # Qemu
    qemu-system \
    # ssh
    openssh-client

# Install Rust
RUN curl https://sh.rustup.rs -sSf | bash -s -- -y

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

# Create Python virtual environment and install common packages
RUN python3 -m venv /home/agent/.venv && \
    /home/agent/.venv/bin/pip install --upgrade pip && \
    /home/agent/.venv/bin/pip install \
    # Data science and analysis
    numpy pandas matplotlib seaborn plotly \
    # Web and API tools
    requests httpx beautifulsoup4

# Configure shell environment
RUN echo 'export PATH="/home/agent/.venv/bin:$PATH"' >> /home/agent/.bashrc && \
    echo 'export PYTHONPATH="/home/agent:$PYTHONPATH"' >> /home/agent/.bashrc && \
    echo 'source $HOME/.cargo/env' >> /home/agent/.bashrc && \
    echo 'alias ll="ls -la"' >> /home/agent/.bashrc && \
    echo 'alias la="ls -la"' >> /home/agent/.bashrc && \
    echo 'cd /home/agent' >> /home/agent/.bashrc

# Default command
CMD ["/bin/bash"]

# Metadata
LABEL maintainer="agent-computer" \
    description="Secure sandbox environment for AI agents" \
    version="1.1"
