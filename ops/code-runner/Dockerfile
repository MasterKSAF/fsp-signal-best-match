FROM python:3.11.14-slim
WORKDIR /runner
COPY run.py /runner/run.py
USER 65532:65532
ENTRYPOINT ["python","-I","/runner/run.py"]
