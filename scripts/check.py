#!/usr/bin/env python3
"""End-to-end check of the mod against a real engine, read from the requests it sends.

Runs six steps through a local proxy that records every request to api.anthropic.com, each with
an MCP server that asks to stay loaded, with as many tools as the desktop app has:
  1. two prompts in one process, then /clear and a third,
  2. a resume of the first conversation with a third prompt, a compaction, and a fourth prompt,
  3. a conversation that saves custom mode through the setup tool, as Claude does, then /clear,
     a prompt and /less-bloat: it makes Write and Skill name-only and keeps the probe's ping, which
     asked to stay loaded, and WebFetch, which the engine defers itself, in full; none of
     ToolSearch, which is required, NotebookEdit, which is name-only already, Bash, which is in
     full already, Edit, which is in both lists, and a name of no tool goes on the list,
  4. a new conversation, which is in custom mode,
  5. a resume of that one-prompt conversation, with a second prompt,
  6. an interactive session, typed into through a terminal, whose server connects after its first
     prompt, with a second prompt after.
It checks that:
  - every request loads in full exactly the tools its mode keeps, of those it carries, and the
    engine's notices or the mod's note name every other tool, from the first request on; ToolSearch, being required,
    stays; default mode loads Bash, Read, Edit, Write, Agent and Skill;
  - every request gives a tool that asked to stay loaded and got its name only its first sentence,
    and none to one the engine defers itself or one in full;
  - later prompts in a process, and a resume, send the same tools and system prompt, and a resume
    after two prompts the same conversation;
  - no step records a tool as announced, as a -p run has nowhere to show the notice;
  - /less-bloat, after a /clear, lists the new conversation: custom mode, with Write name-only and
    ping in full;
  - each step has the setup tool; the setup saves to the store, and the saving conversation stays
    in default mode while the one after its /clear is in custom mode; the conversation after the
    first /clear needs no longer a note than the first;
  - in the interactive session, in custom mode, pong, which asks to stay loaded and arrived late,
    comes in a message with its definition, no probe tool is announced as name-only, and the tools
    and system prompt never change.

Usage: scripts/check.py [path to claude]   (default: claude on PATH)
Costs eleven short prompts and a compaction. Sets aside the store of an inline less-bloat, as a
.bak file beside it, and puts it back after, so a dev session on this folder sees default mode
meanwhile and loses a save made then. The interactive session runs in this folder, which Claude
Code must already trust, or it stops before typing; its two prompts stay in Claude Code's prompt
history. Deletes the transcripts it makes; prints each request's token usage and the file of
recorded requests, which it writes even when a step fails; exits 1 on failure.
"""
import fcntl
import http.client
import glob
import json
import os
import pty
import re
import select
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PLUGIN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOTICE_HEADING = 'deferred tools are now available'
NOTE = 'Also deferred behind ToolSearch; load with "select:<name>": '


def default_lists():
    """The tools default mode keeps loaded in full: REQUIRED and RECOMMENDED, read from the mod's source."""
    with open(f'{PLUGIN}/hooks/tools.ts') as f:
        source = f.read()
    required = re.findall(r"'([\w-]+)'", re.search(r'REQUIRED = \[(.*?)\]', source)[1])
    recommended = re.findall(r"^  '?([\w-]+)'?:", re.search(r'RECOMMENDED.*?\{(.*?)^\}', source, re.S | re.M)[1], re.M)
    return set(required), set(recommended)


# The tools default mode must keep loaded, of those a -p run has (AskUserQuestion it hasn't).
CORE = {'Bash', 'Read', 'Edit', 'Write', 'Agent', 'Skill'}

# Tools the engine itself defers, so the mod adds no sentence to their names.
ENGINE_DEFERRED = {'WebFetch', 'WebSearch', 'NotebookEdit'}

# Custom mode's lists, as the setup is asked to save them, and as they are saved:
# ToolSearch is required, NotebookEdit name-only already, Bash in full already, Edit in both lists
# and nope no tool, so none takes.
NAME_ONLY = ['Write', 'Skill', 'ToolSearch', 'NotebookEdit', 'Edit']
FULL = ['mcp__probe__ping', 'WebFetch', 'Bash', 'Edit', 'mcp__probe__nope']
SAVED = {'nameOnly': ['Write', 'Skill'], 'full': ['mcp__probe__ping', 'WebFetch']}
SAVE = (f'Call mcp__less-bloat__setup with mode "custom", nameOnly {json.dumps(NAME_ONLY)} and upFront {json.dumps(FULL)}, '
        'loading it with ToolSearch first if it is deferred. Then reply with its result.')

# Descriptions as servers write them, each with the first sentence the mod gives it: a line wrapped
# mid-sentence, parameter lines under a summary with no stop, a lowercase line after a stop, and a
# new sentence on a line of its own.
DESCRIPTIONS = {
    'pong': ('Replies pong, e.g. "pong",\r\nto any input. It never fails.\r\n\r\nIt takes no input.', 'Replies pong, e.g. "pong", to any input.'),
    'more0': ('Get the forecast for a location\n    latitude: its latitude\n    longitude: its longitude', 'Get the forecast for a location'),
    'more1': ('Create an issue.\nowner and repo are required.', 'Create an issue.'),
    'more2': ('Query the database\nReturns rows as JSON. Takes about 2 seconds.', 'Query the database'),
}

# A stdio MCP server that asks to stay loaded, so it is connected when the session starts, and the
# mod defers its tools as it does Claude Code's own. It has 150 more tools, about as many as the
# desktop app's servers. Given a number of seconds, it takes that long to connect, and leaves a file
# beside itself once it lists its tools.
PROBE = """
import json, sys, time
DESCRIPTIONS = __DESCRIPTIONS__
schema = {'type': 'object', 'properties': {}}
for line in sys.stdin:
    message = json.loads(line)
    if 'id' not in message:
        continue
    if message['method'] == 'initialize' and len(sys.argv) > 1:
        time.sleep(float(sys.argv[1]))
    if message['method'] == 'tools/list' and len(sys.argv) > 1:
        open(sys.argv[0] + '.connected', 'w').close()
    result = {
        'initialize': {'protocolVersion': message.get('params', {}).get('protocolVersion'), 'capabilities': {'tools': {}},
                       'serverInfo': {'name': 'probe', 'version': '1'}},
        'tools/list': {'tools': [{'name': n, 'description': DESCRIPTIONS.get(n, f'Replies {n}.'), 'inputSchema': schema} for n in ['ping', 'pong'] + [f'more{i}' for i in range(150)]]},
    }.get(message['method'], {})
    print(json.dumps({'jsonrpc': '2.0', 'id': message['id'], 'result': result}), flush=True)
""".replace('__DESCRIPTIONS__', repr({n: d for n, (d, _) in DESCRIPTIONS.items()}))


def record(exchanges):
    """A proxy to the API that appends each Messages request, with the usage it was billed, to `exchanges`."""
    class Proxy(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers.get('content-length', 0)))
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'accept-encoding')}
            upstream = http.client.HTTPSConnection('api.anthropic.com', timeout=300)
            upstream.request(self.command, self.path, body, headers)
            response = upstream.getresponse()
            data = response.read()
            upstream.close()
            # A failed request is retried, and only the retry counts.
            if self.path.split('?')[0] == '/v1/messages' and response.status == 200:
                # A streamed response reports usage more than once; the last count is the final one.
                usage = re.findall(rb'"((?:cache_creation_|cache_read_)?input_tokens)":(\d+)', data)
                exchanges.append({'request': json.loads(body), 'usage': {k.decode(): int(v) for k, v in usage}})
            self.send_response(response.status)
            for k, v in response.getheaders():
                if k.lower() not in ('transfer-encoding', 'content-length', 'connection'):
                    self.send_header(k, v)
            self.send_header('content-length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def claude(cli, cwd, port, prompts, *args):
    """One process answering `prompts` in turn, each sent once the last is answered, as a person
    types them, without the user's settings (where the mod may be installed) or MCP servers but the
    probe. Returns the session id, the process's tools and each prompt's result text."""
    process = subprocess.Popen([cli, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
                                '--max-turns', '1', *isolated(cwd), *args],
                               cwd=cwd, env=environment(port), stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    events = []
    # A step that never ends kills the process, which fails the step.
    timer = threading.Timer(600, process.kill)
    timer.start()
    try:
        for prompt in prompts:
            process.stdin.write(json.dumps({'type': 'user', 'message': {'role': 'user', 'content': prompt}}) + '\n')
            process.stdin.flush()
            for line in process.stdout:
                events.append(json.loads(line))
                if events[-1].get('type') == 'result':
                    break
        process.stdin.close()
        if process.wait(timeout=60):
            raise subprocess.CalledProcessError(process.returncode, cli)
    finally:
        timer.cancel()
        process.kill()
    init = next(e for e in events if e.get('subtype') == 'init')
    # The init message gives Agent by its old name.
    results = [e.get('result', '') for e in events if e.get('type') == 'result']
    return init['session_id'], {'Agent' if t == 'Task' else t for t in init['tools']}, results


def environment(port):
    """The environment of a process that sends its requests through the proxy."""
    env = {k: v for k, v in os.environ.items() if k != 'CLAUDE_CODE_PLUGIN_DIRS'}
    # Behind a base URL that isn't Anthropic's, the engine turns ToolSearch off unless told otherwise.
    return env | {'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{port}', 'ENABLE_TOOL_SEARCH': 'true'}


def isolated(cwd, *probe_args):
    """The arguments that load the mod and the probe, and nothing of the user's."""
    probe = {'mcpServers': {'probe': {'command': sys.executable, 'args': [f'{cwd}/probe.py', *probe_args], 'alwaysLoad': True}}}
    return ['--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', json.dumps(probe), '--plugin-dir', PLUGIN]


def interactive(cli, cwd, port, exchanges, session, delay):
    """An interactive session in this folder, typed into through a terminal, whose probe takes
    `delay` seconds to connect: one prompt before it does and one after, each typed once the last is
    answered. Returns why it stopped short, if it did."""
    cli = shutil.which(cli) or cli
    pid, fd = pty.fork()
    if pid == 0:
        # The child never returns into this script, even when the exec fails.
        try:
            fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 160, 0, 0))
            os.chdir(PLUGIN)
            os.execve(cli, [cli, '--session-id', session, *isolated(cwd, str(delay))], environment(port) | {'PWD': os.path.realpath(PLUGIN)})
        finally:
            os._exit(127)
    screen = []

    def drain(seconds, quiet=None):
        """Read what the session draws for `seconds`, or until, once it has drawn, it draws nothing for
        `quiet` seconds, so it never blocks on a full terminal. Raises OSError once the session has exited."""
        end, drawn = time.time() + seconds, None
        while time.time() < end and not (quiet and drawn and time.time() - drawn > quiet):
            if select.select([fd], [], [], 0.2)[0]:
                # Linux raises once the session has exited; macOS reads nothing.
                chunk = os.read(fd, 65536)
                if not chunk:
                    raise OSError('the session exited')
                screen.append(chunk)
                drawn = time.time()

    def say(text):
        sent = len(main_loop(exchanges))
        for ch in text:
            os.write(fd, ch.encode())
            drain(0.02)
        drain(0.5)
        os.write(fd, b'\r')
        end = time.time() + 120
        while time.time() < end and len(main_loop(exchanges)) == sent:
            drain(0.5)
        # The answer streams back after the request is recorded.
        drain(5)

    try:
        drain(30, quiet=3)
        # In a folder it doesn't trust, Claude Code first asks, and Enter would answer yes.
        if re.search(rb'trust', b''.join(screen), re.I):
            return f'Claude Code asks whether to trust {PLUGIN}; start it there once and answer yes'
        say('Say ok.')
        end = time.time() + 60
        while time.time() < end and not os.path.exists(f'{cwd}/probe.py.connected'):
            drain(0.5)
        drain(2)
        say('Say ok again.')
    except OSError:
        last = re.sub(rb'\x1b\[[0-9;?]*[A-Za-z]', b'', b''.join(screen))[-400:].decode(errors='replace')
        return f'the interactive session exited early; its screen ended:\n{last}'
    finally:
        try:
            os.killpg(pid, 9)
        except OSError:
            pass
        os.waitpid(pid, 0)
        os.close(fd)


def main_loop(exchanges):
    """The main loop's requests, and the compaction's; the side calls, such as titles, carry no ToolSearch."""
    return [x for x in exchanges if any(t['name'] == 'ToolSearch' for t in x['request'].get('tools', []))]


def texts(request):
    """The text of a request's messages, except the model's own, which may quote a notice, and the
    compaction's summary, which the model wrote."""
    for message in request['messages']:
        if message['role'] == 'assistant':
            continue
        content = message['content']
        for block in content if isinstance(content, list) else [{'text': content}]:
            text = block.get('text', '')
            if not text.startswith('This session is being continued from a previous conversation'):
                yield text


def lines_after(request, heading):
    """The lines after each line with `heading` in a request, up to one that names no tool: each
    tool's name, with the text after `name: `, or None."""
    lines = {}
    for text in texts(request):
        listing = False
        for line in text.splitlines():
            if listing and (match := re.fullmatch(r'([\w-]+)(?:: (.+))?', line)):
                lines[match[1]] = match[2]
            else:
                listing = heading in line
    return lines


def notice(request):
    """Every tool name the engine's notices and the mod's note in a request give. A notice is a
    heading, then one tool per line; the note one line."""
    return set(lines_after(request, NOTICE_HEADING)) | noted(request)


def added(request):
    """The tools a request's messages add with their definition, as the engine adds a deferred tool
    that arrives after the first prompt."""
    return {b['tool']['definition']['name'] for m in request['messages'] if isinstance(m['content'], list)
            for b in m['content'] if b.get('type') == 'tool_addition'}


def noted(request):
    """The tool names the mod's note in a request gives."""
    return {n for text in texts(request) for line in text.splitlines() if NOTE in line
            for n in line.split(NOTE, 1)[1].split(', ')}


def uncached(value, markers=False):
    """A request part as the prompt cache reads it: without the billing header, which changes each
    request with the mod or without, with a lone text block as the plain string the API reads
    alike, and, unless `markers`, without its cache markers, which move to the newest message each
    turn."""
    if isinstance(value, list):
        value = [v for v in value if not (isinstance(v, dict) and v.get('text', '').startswith('x-anthropic-billing-header:'))]
    if isinstance(value, dict):
        content = value.get('content')
        if isinstance(content, list) and len(content) == 1 and set(content[0]) <= {'type', 'text', 'cache_control'}:
            value = {**value, 'content': content[0]['text']}
        return {k: uncached(v, markers) for k, v in value.items() if markers or k != 'cache_control'}
    if isinstance(value, list):
        return [uncached(v, markers) for v in value]
    return value


def main():
    cli = sys.argv[1] if len(sys.argv) > 1 else 'claude'
    required, recommended = default_lists()
    default = required | recommended
    custom = (default - set(SAVED['nameOnly'])) | set(SAVED['full'])
    exchanges, steps = [], []
    failures = []
    server = record(exchanges)
    cwd = os.path.realpath(tempfile.mkdtemp())
    with open(f'{cwd}/probe.py', 'w') as f:
        f.write(PROBE)

    def step(name, keep, prompts, *args):
        start = len(exchanges)
        session, tools, results = claude(cli, cwd, server.server_address[1], prompts, *args)
        requests = main_loop(exchanges[start:])
        steps.append({'name': name, 'keep': keep, 'tools': tools, 'requests': requests, 'results': results})
        if 'mcp__less-bloat__setup' not in tools:
            failures.append(f'{name} has no setup tool')
        return session

    # The mod keeps its list in a store file per plugin; a --plugin-dir one's is `less-bloat_inline-*`.
    config = os.environ.get('CLAUDE_CONFIG_DIR', os.path.expanduser('~/.claude'))
    stores = f'{config}/plugins/store/less-bloat_inline-*.json'
    kept = glob.glob(stores)
    for path in kept:
        os.replace(path, f'{path}.bak')
    def store():
        """What the mod keeps in its store, from the one file the run made."""
        paths = glob.glob(stores)
        if len(paths) != 1:
            return {}
        with open(paths[0]) as f:
            return json.load(f)

    try:
        session = step('two prompts', default, ['Say ok.', 'Say ok again.', '/clear', 'Say ok after clearing.'])
        step('resume', default, ['Say ok a third time.', '/compact', 'Say ok once more.'], '--resume', session)
        step('save', default, [SAVE, '/clear', 'Say ok.', '/less-bloat'], '--max-turns', '4', '--allowedTools', 'mcp__less-bloat__setup')
        listed = steps[-1]['results'][-1]
        made = listed.partition('Name-only in custom mode:\n')[2].partition('Name-only by')[0]
        full = listed.partition('Described up-front:\n')[2].partition('Name-only')[0]
        if 'Saved mode: custom' not in listed or '- Write: ' not in made or '- mcp__probe__ping: your pick in custom mode' not in full:
            failures.append(f'/less-bloat after /clear did not list custom mode with Write name-only and ping described up-front:\n{listed}')
        # The prompt after /clear starts the next conversation, which is in custom mode; /less-bloat sends no request.
        cleared = steps[-1]['requests'][-1:]
        del steps[-1]['requests'][-1:]
        steps.append({**steps[-1], 'name': 'save, after /clear', 'keep': custom, 'requests': cleared})
        saved = store().get('list')
        if not saved or {k: sorted(v) for k, v in saved.items()} != {k: sorted(v) for k, v in SAVED.items()}:
            failures.append(f'the setup saved {saved or "no list"} to the store at {stores}, not {SAVED}')
        session = step('custom mode', custom, ['Say ok.'])
        step('custom resume', custom, ['Say ok again.'], '--resume', session)
        if 'announced' in store():
            failures.append(f'a -p run, with nowhere to show it, recorded a notice as shown: {store()["announced"]}')
        # The interactive session runs in this folder, where its transcript is the one with its id.
        start, session = len(exchanges), str(uuid.uuid4())
        transcript = f"{config}/projects/{re.sub(r'[^A-Za-z0-9]', '-', os.path.realpath(PLUGIN))}/{session}"
        try:
            stopped = interactive(cli, cwd, server.server_address[1], exchanges, session, 20)
        finally:
            if os.path.exists(f'{transcript}.jsonl'):
                os.remove(f'{transcript}.jsonl')
            shutil.rmtree(transcript, ignore_errors=True)
        late = main_loop(exchanges[start:])
        if stopped:
            failures.append(stopped)
        if any(n.startswith('mcp__probe__') for n in store().get('announced', [])):
            failures.append(f'the interactive session tells of the late probe\'s tools as name-only: {store()["announced"]}')
    finally:
        for path in glob.glob(stores):
            os.remove(path)
        for path in kept:
            os.replace(f'{path}.bak', path)
        server.shutdown()
        server.server_close()
        shutil.rmtree(cwd)
        # The engine keeps a folder's transcripts under its path, with every character but letters and
        # digits turned into a dash.
        shutil.rmtree(f"{config}/projects/{re.sub(r'[^A-Za-z0-9]', '-', cwd)}", ignore_errors=True)
        with tempfile.NamedTemporaryFile('w', prefix='less-bloat-requests-', suffix='.json', delete=False) as f:
            json.dump(exchanges, f)
        print(f'Recorded requests: {f.name}')

    report = []
    for s in steps:
        keep = s['keep']
        for i, x in enumerate(s['requests']):
            where = f"{s['name']}, request {i + 1}"
            request = x['request']
            # The placeholder is the engine's stub that keeps deferral on, not a tool to name.
            sent = {t['name'] for t in request['tools']} - {'DeferredToolPlaceholder'}
            loaded = {t['name'] for t in request['tools'] if not t.get('defer_loading')}
            unnamed = (s['tools'] | sent) - keep - notice(request)
            report.append({'request': where, 'usage': x['usage']})
            if loaded - keep:
                failures.append(f'{where} loads {sorted(loaded - keep)} in full')
            if (keep & sent) - loaded:
                failures.append(f'{where} defers {sorted((keep & sent) - loaded)}')
            if unnamed:
                failures.append(f'{where} never names {sorted(unnamed)}')
            # The probe's tools ask to stay loaded, so those made name-only keep their first sentence; a
            # tool the engine defers itself keeps its name only.
            sentences = {n: t for n, t in lines_after(request, NOTICE_HEADING).items() if t}
            expect = {f'mcp__probe__{n}': sentence for n, (_, sentence) in DESCRIPTIONS.items()}
            for name in ENGINE_DEFERRED | set(expect):
                expected = expect.get(name)
                if sentences.get(name) != expected:
                    failures.append(f'{where} gives {name} the sentence {sentences.get(name)!r}, not {expected!r}')
            # Typed apart from the mod's source, so a name misspelt there, or renamed by the engine, fails.
            if keep == default and CORE - loaded:
                failures.append(f'{where} does not load {sorted(CORE - loaded)} in full')

    # The resume sends the third prompt, the compaction, and the fourth prompt.
    two, resumed, save, cleared, custom_run, custom_resumed = (s['requests'] for s in steps)
    if not any('Saved custom mode' in json.dumps(x['request']['messages']) for x in save):
        failures.append('the setup did not save custom mode')
    sent = tuple(len(r) for r in (two, resumed, cleared, custom_run, custom_resumed))
    if sent != (3, 3, 1, 1, 1) or not save:
        failures.append(f'the steps sent {sent} requests, not (3, 3, 1, 1, 1), and {len(save)} to save')
    else:
        pairs = (('second prompt', two[0], two[1]), ('prompt after /clear', two[1], two[2]),
                 ('resume', two[1], resumed[0]), ('prompt after /compact', resumed[0], resumed[2]),
                 ('custom resume', custom_run[0], custom_resumed[0]))
        for name, before, after in pairs:
            for part in ('tools', 'system'):
                if uncached(after['request'][part], True) != uncached(before['request'][part], True):
                    failures.append(f'the {name} changes the {part}')
        # The engine reshapes a conversation's first messages after its first prompt, with the mod or
        # without, so the messages replay unchanged only from the second prompt on.
        before = uncached(two[1]['request']['messages'])
        if uncached(resumed[0]['request']['messages'][:len(before)]) != before:
            failures.append('the resume changes the conversation so far')
        after_compact = resumed[2]['request']
        if len(after_compact['messages']) >= len(resumed[0]['request']['messages']):
            failures.append('/compact does not shorten the conversation')
        if len(two[2]['request']['messages']) >= len(two[1]['request']['messages']):
            failures.append('/clear does not start a new conversation')
        if len(cleared[0]['request']['messages']) >= len(save[-1]['request']['messages']):
            failures.append('the /clear after saving does not start a new conversation')
        # The conversation after /clear starts as the first did; a longer note means its tools were
        # placed under the old conversation.
        if len(noted(two[2]['request'])) > len(noted(two[0]['request'])):
            failures.append('the note after /clear names more tools than the first')

    # The interactive session: the probe, which asks to stay loaded, connects after the first prompt,
    # so its tools come in a message in full, pong's though custom mode doesn't keep it up-front, and
    # the tools and system prompt stay as the first prompt sent them.
    pong = 'mcp__probe__pong'
    for i, x in enumerate(late):
        report.append({'request': f'interactive, request {i + 1}', 'usage': x['usage']})
    if len(late) < 2:
        failures.append(f'the interactive session sent {len(late)} requests, not 2 or more')
    elif pong in notice(late[0]['request']) | added(late[0]['request']) | {t['name'] for t in late[0]['request']['tools']}:
        failures.append('the probe connected before the interactive session\'s first prompt, so nothing arrived late')
    else:
        if pong not in added(late[-1]['request']):
            failures.append('the interactive session never adds pong, which arrived late, in a message')
        for x in late[1:]:
            for part in ('tools', 'system'):
                if uncached(x['request'][part], True) != uncached(late[0]['request'][part], True):
                    failures.append(f'the late probe changes the interactive session\'s {part}')

    print(json.dumps({'requests': report, 'failures': failures}, indent=2))
    print('FAIL' if failures else 'PASS')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
