import json, os, platform, resource, selectors, signal, subprocess, sys, tempfile, time

VERSION = 'signal-python-runner-v1'
LIMIT = 8192

def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
    resource.setrlimit(resource.RLIMIT_AS, (128 * 1024 * 1024, 128 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    resource.setrlimit(resource.RLIMIT_NPROC, (16, 16))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

def result(status, reason=None, output=None):
    return dict(status=status, reason=reason, output=output, runnerVersion=VERSION,
                language='python', runtimeVersion=platform.python_version())

def run():
    raw = sys.stdin.buffer.read(131073)
    if len(raw) > 131072:
        return result('infrastructure_error', 'invalid_packet')
    packet = json.loads(raw)
    source = packet['source']
    if not isinstance(source, str) or len(source.encode()) > 65536:
        return result('infrastructure_error', 'invalid_packet')
    try:
        compile(source, 'submission.py', 'exec')
    except SyntaxError:
        return result('compile_error', 'syntax_error')
    with tempfile.TemporaryDirectory(prefix='run-', dir='/tmp') as directory:
        path = os.path.join(directory, 'submission.py')
        with open(path, 'w', encoding='utf-8') as target:
            target.write(source)
        process = subprocess.Popen(
            ['/usr/local/bin/python', '-I', path], cwd=directory,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': directory,
                 'TMPDIR': directory, 'LANG': 'C.UTF-8', 'PYTHONHASHSEED': '0'},
            start_new_session=True, preexec_fn=limits)
        # Tests contain no expected output. The API coordinator checks it outside this sandbox.
        process.stdin.write((json.dumps(packet['input']) + '\n').encode())
        process.stdin.close()
        poll = selectors.DefaultSelector()
        poll.register(process.stdout, selectors.EVENT_READ, 'out')
        poll.register(process.stderr, selectors.EVENT_READ, 'err')
        collected = {'out': bytearray(), 'err': bytearray()}
        started = time.monotonic()
        status = None
        try:
            while poll.get_map():
                if time.monotonic() - started > 3:
                    status = result('time_limit', 'wall_time')
                    break
                for key, _ in poll.select(.05):
                    data = os.read(key.fileobj.fileno(), 4096)
                    if not data:
                        poll.unregister(key.fileobj)
                        continue
                    collected[key.data].extend(data)
                    if len(collected[key.data]) > LIMIT:
                        status = result('runtime_error', 'output_limit')
                        break
                if status:
                    break
        finally:
            if process.poll() is None or status:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait(timeout=1)
            poll.close()
        if status:
            return status
        if process.returncode in (-signal.SIGXCPU, -signal.SIGKILL):
            return result('time_limit', 'cpu_limit')
        if process.returncode:
            return result('memory_limit' if b'MemoryError' in collected['err'] else 'runtime_error', 'process_failed')
        return result('executed', output=bytes(collected['out']).decode('utf-8', errors='strict'))

try:
    payload = run()
except BaseException:
    payload = result('infrastructure_error', 'runner_protocol_failed')
print(json.dumps(payload, ensure_ascii=True))
