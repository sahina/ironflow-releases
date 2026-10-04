# The engine is one static binary. Copy it into the app's own base image; the
# engine image itself is Alpine and has no Python.
ARG ENGINE_IMAGE=ghcr.io/sahina/ironflow-releases:0.40.0
FROM ${ENGINE_IMAGE} AS engine

FROM python:3.14-slim
COPY --from=engine /app/ironflow /usr/local/bin/ironflow

RUN useradd --system --create-home app && mkdir /data && chown app:app /data
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py worker.py entrypoint.sh ./

# No USER line: the entrypoint starts as root only to take ownership of a platform volume
# (Fly mounts /data root-owned), then drops to the app user.
# All engine state: SQLite, the NATS store, blobs, the bootstrap key file.
VOLUME ["/data"]
EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
