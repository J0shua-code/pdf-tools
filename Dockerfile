# syntax=docker/dockerfile:1
# Reproducible build environment for Ghostscript WebAssembly.

ARG EMSCRIPTEN_VERSION=6.0.7
FROM emscripten/emsdk:${EMSCRIPTEN_VERSION}

LABEL org.opencontainers.image.title="Ghostscript WASM Builder"
LABEL org.opencontainers.image.description="Reproducible Ghostscript WASM build environment"

# Install Ghostscript build dependencies. Versions are pinned to the
# Debian release shipped with the emscripten/emsdk image for this
# Emscripten version; update them when changing EMSCRIPTEN_VERSION.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential=12.9 \
    autoconf=2.71-3 \
    automake=1:1.16.5-1.3 \
    libtool=2.4.7-7 \
    cmake=3.25.1-1 \
    pkg-config=1.8.1-1 \
    git=1:2.39.5-0+deb12u2 \
    curl=7.88.1-10+deb12u9 \
    unzip=6.0-28 \
    wget=1.21.3-1+deb12u1 \
    ca-certificates=20230311 \
    python3=3.11.2-1+b1 \
    python3-distutils=3.11.2-3 \
    libtiff-dev=4.5.0-6+deb12u2 \
    libjpeg62-turbo-dev=1:2.1.5-2 \
    libpng-dev=1.6.39-2 \
    libfreetype6-dev=2.12.1+dfsg-5+deb12u3 \
    libfontconfig1-dev=2.14.1-4 \
    liblcms2-dev=2.14-2 \
    libopenjp2-7-dev=2.5.0-2 \
    zlib1g-dev=1:1.2.13.dfsg-1 \
    && rm -rf /var/lib/apt/lists/*

# Derive the bundled Node.js path from the emsdk image rather than
# hard-coding a version number. The emscripten/emsdk image already sets
# PATH for interactive shells; we ensure it is also set for the
# non-interactive login shell used by CMD below.
ENV EMSDK=/emsdk
RUN NODE_BIN=$(ls -d /emsdk/node/*/bin 2>/dev/null | head -n1) \
    && { \
      echo "export PATH=\"${NODE_BIN}:/emsdk/upstream/emscripten:\${PATH}\""; \
      echo "export EMSDK=/emsdk"; \
      echo "export EMSDK_NODE=\"${NODE_BIN}/node\""; \
    } > /etc/profile.d/emsdk-env.sh \
    && chmod +x /etc/profile.d/emsdk-env.sh

# Verify Emscripten version in a login shell so the PATH above is active.
RUN bash -l -c "emcc --version"

WORKDIR /project

# Default command: download source and build. Use a login shell so the
# Emscripten environment from /etc/profile.d is sourced automatically.
CMD ["bash", "-l", "scripts/build.sh"]
