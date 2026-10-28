FROM python:3.11.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt /opt/requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r /opt/requirements.txt
COPY extract.py /opt/extract.py
USER 65532:65532
ENTRYPOINT ["python", "-I", "/opt/extract.py"]
