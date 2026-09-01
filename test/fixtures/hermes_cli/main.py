# test/fixtures/hermes_cli/main.py — fake hermes_cli.main para run-integration tests
#
# Substitui o hermes_cli real quando o wrapper python do launchHermes (server/api.ts L410-441)
# faz `subprocess.call([sys.executable, "-m", "hermes_cli.main", "-z", prompt])`.
# Activado por HERMES_FAKE_MODE (env):
#   write_result   -> edita kanban.json com card.result, exit 0  (happy path)
#   forget_result  -> NAO edita kanban.json, exit 0                 (B1 forget_result)
#   crash          -> NAO edita nada, exit 1                        (B1 variant crash)
#
# O wrapper real (api.ts wrapperWithPane) ja' grava {state:running,pane,ts} em .status antes
# de nos chamar. Aqui so' precisamos de: (a) criar um commit no wt para o auto-merge nao
# ficar trivial-empty, (b) opcionalmente editar o kanban.json, (c) exit certo.
import os, sys, json, subprocess

MODE = os.environ.get('HERMES_FAKE_MODE', 'write_result')
SLUG = os.environ['HERMES_FAKE_SLUG']
CARD_ID = os.environ['HERMES_FAKE_CARDID']
# argv: -z <prompt> vem do wrapper; ignoramos
# Encontrar wt e repo:
# o wrapper faz os.chdir(repo) DEPOIS de nos chamar; portanto o cwd actual e' o do
# worktree pai (atlasRepo, tmpdir). Mas wt argv vem de sys.argv[2] do wrapper...
# so' que NAO temos acesso directo a sys.argv do wrapper. Solucao: o wrapper
# passa-os como env vars adicionais.

# Worktree path: vem do wrapper como argv[2]. Quando somos chamados via `python -m hermes_cli.main -z prompt`,
# o nosso sys.argv e' ['/path/to/hermes_cli/__main__.py', '-z', prompt]. NAO temos o wt do wrapper.
# Solucao: o wrapper python, antes de nos invocar, faz `os.chdir(repo)` ou expoe wt via env.
# Hack limpo: o test harness expoe HERMES_FAKE_WT e HERMES_FAKE_REPO via env. O wrapper herda
# process.env do Node spawn. O Node spawn ja' mete HERMES_HOME; junta-se HERMES_FAKE_*.
WT = os.environ['HERMES_FAKE_WT']
REPO = os.environ['HERMES_FAKE_REPO']

# 1. wt/fake-worker-output.txt + git commit na worktree (worktree ja' esta' na branch feature/...)
wt_file = os.path.join(WT, 'fake-worker-output.txt')
os.makedirs(WT, exist_ok=True)
with open(wt_file, 'w', encoding='utf-8') as f:
    f.write(f'mode={MODE}\n')
try:
    env_git = {**os.environ, 'GIT_AUTHOR_NAME': 'fake', 'GIT_AUTHOR_EMAIL': 'f@x',
               'GIT_COMMITTER_NAME': 'fake', 'GIT_COMMITTER_EMAIL': 'f@x'}
    subprocess.run(['git', 'add', 'fake-worker-output.txt'], cwd=WT, check=True, env=env_git)
    subprocess.run(['git', 'commit', '-m', f'fake worker {MODE}'], cwd=WT, check=True, env=env_git)
except Exception as e:
    # sem git ou repo mal-formado -> prossegue (test que nao precisa de commit)
    print(f'[fake-hermes] commit skip: {e}', file=sys.stderr)

# 2. modo write_result: edita kanban.json para gravar card.result
if MODE == 'write_result':
    kanban = os.path.join(REPO, 'data', SLUG, 'kanban.json')
    try:
        with open(kanban, 'r+', encoding='utf-8') as f:
            board = json.load(f)
            card = next((c for c in board['cards'] if c['id'] == CARD_ID), None)
            if card is not None:
                card['result'] = 'worker done ok'
            f.seek(0); json.dump(board, f); f.truncate()
    except Exception as e:
        print(f'[fake-hermes] kanban edit fail: {e}', file=sys.stderr)
# forget_result e crash: NAO tocam kanban.json

# 3. exit code
sys.exit(0 if MODE in ('write_result', 'forget_result') else 1)
