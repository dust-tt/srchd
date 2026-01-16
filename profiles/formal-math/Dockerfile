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
    # Python ecosystem
    python3 python3-pip python3-venv python3-dev \
    # Text processing
    jq xmlstarlet \
    # Search Tools
    ripgrep

# Create non-root user 'agent' with uid 1001
RUN groupadd -g 1001 agent && \
    useradd -u 1001 -g 1001 -m -s /bin/bash agent && \
    # Give agent sudo access (for permissive mode)
    echo 'agent ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Install lean
RUN export HOME=/home/agent; curl https://elan.lean-lang.org/elan-init.sh -sSf | sh -s -- -y && \
    echo 'export PATH="/home/agent/.elan/bin:$PATH"' >> /home/agent/.bashrc && \
    # We need `lake` to be in our path
    export PATH="/home/agent/.elan/bin:$PATH" && \
    # install lean mathlib since it's quite long to download
    cd /home/agent/ && lake +leanprover-community/mathlib4:lean-toolchain new Math && \
    cd Math && lake build && \
    chown -R agent:agent /home/agent

USER agent
WORKDIR /home/agent

# Create Python virtual environment and install common packages
RUN python3 -m venv /home/agent/.venv && \
    /home/agent/.venv/bin/pip install --upgrade pip && \
    /home/agent/.venv/bin/pip install \
    # Data science and analysis
    numpy pandas matplotlib seaborn plotly

# Configure shell environment
RUN echo 'export PATH="/home/agent/.venv/bin:$PATH"' >> /home/agent/.bashrc && \
    echo 'export PYTHONPATH="/home/agent:$PYTHONPATH"' >> /home/agent/.bashrc && \
    echo 'alias ll="ls -la"' >> /home/agent/.bashrc && \
    echo 'alias la="ls -la"' >> /home/agent/.bashrc && \
    echo 'source $HOME/.elan/env' >> /home/agent/.bashrc && \
    echo 'cd /home/agent' >> /home/agent/.bashrc

# Default command
CMD ["/bin/bash"]

# Metadata
LABEL maintainer="agent-computer" \
      description="Secure sandbox environment for AI agents" \
      version="1.1"
