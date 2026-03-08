# Dockerfile for agent-computer:research
# Provides an isolated environment for computational research and simulation

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
    # Text processing
    jq ripgrep \
    # Archive tools
    zip unzip tar gzip \
    # SSH tools (for ssh-keyscan)
    openssh-client \
    # Visualization (for headless matplotlib)
    libcairo2-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user 'agent' with uid 1001
RUN groupadd -g 1001 agent && \
    useradd -u 1001 -g 1001 -m -s /bin/bash agent && \
    echo 'agent ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

RUN mkdir -p /home/agent/.ssh && \
    chown -R agent:agent /home/agent/.ssh && \
    chmod 700 /home/agent/.ssh

USER agent
# IDENTITY_FILES_COPY_PLACEHOLDER
WORKDIR /home/agent

RUN ssh-keyscan github.com >> /home/agent/.ssh/known_hosts

# Create Python virtual environment and install scientific packages
RUN python3 -m venv /home/agent/.venv && \
    /home/agent/.venv/bin/pip install --upgrade pip && \
    /home/agent/.venv/bin/pip install \
    # Scientific computing
    numpy scipy \
    # Data analysis
    pandas \
    # Visualization
    matplotlib \
    # Web and API tools
    requests httpx beautifulsoup4

# Configure shell environment
RUN echo 'export PATH="/home/agent/.venv/bin:$PATH"' >> /home/agent/.profile && \
    echo 'export PATH="/home/agent/.venv/bin:$PATH"' >> /home/agent/.bashrc && \
    echo 'alias ll="ls -la"' >> /home/agent/.bashrc && \
    echo 'cd /home/agent' >> /home/agent/.bashrc

# Default command
CMD ["/bin/bash"]

# Metadata
LABEL maintainer="agent-computer" \
      description="Sandbox environment for computational research and simulation" \
      version="1.0"
