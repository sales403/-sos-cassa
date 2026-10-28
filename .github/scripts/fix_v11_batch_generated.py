from pathlib import Path

for path in [Path('app.js'), Path('preview-v11/app.js')]:
    if not path.exists():
        continue
    a = path.read_text()
    anchor = a.find('function stopClientBatchPolling')
    start = a.find("\n{\n  const status=$('clientSendStatus')", anchor)
    end = a.find('function showClientRequestStatus', start if start >= 0 else anchor)
    if start >= 0 and end > start:
        a = a[:start] + '\n' + a[end:]
        path.write_text(a)
        print('repaired', path)
    else:
        print('no orphan submit body found in', path)
