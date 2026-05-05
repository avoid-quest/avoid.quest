FROM oven/bun:1.3.10-debian

# Install system dependencies
RUN apt-get update && apt-get install -y \
  ca-certificates \
  git \
  curl \
  jq \
  procps \
  ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Rename the base image's "bun" user (UID 1000) to "agent".
# This keeps UID 1000 so that --userns=keep-id (Podman) and
# --user 1000:1000 (Docker) map to the correct home directory owner.
RUN groupmod -n agent bun \
  && usermod -d /home/agent -m -l agent bun \
  && chown -R agent:agent /home/agent \
  && chmod 777 /home/agent \
  && chmod a+rw /home/agent/.bashrc /home/agent/.profile

USER agent

ENV BUN_INSTALL=/home/agent/.bun
ENV BUN_INSTALL_BIN=/home/agent/.bun/bin
ENV PATH=/home/agent/.bun/bin:$PATH

WORKDIR /home/agent

RUN mkdir -p /home/agent/.bun/install/cache /home/agent/.codex /home/agent/.convex \
  && bun install -g @openai/codex \
  && chmod -R a+rX /home/agent/.bun \
  && chmod 777 /home/agent/.codex /home/agent/.convex

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
