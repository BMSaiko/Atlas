import sys, os, importlib.util as _iu
# ponytail: PYTHONPATH é setado pelo _atlas-harness.mjs mas o venv python (cfg.hermesPy) tem
# hermes_cli instalado via pip install -e . (path hook em __editable__). FIXTURES no path
# não chega para shadowar. Carregamos o stub manualmente e bloqueamos em sys.modules —
# o import subsequente de hermes_cli.main pelo wrapper python encontra o stub.
_here = os.path.dirname(__file__)
_spec = _iu.find_spec('hermes_cli', [_here])
if _spec is not None:
    _m = _iu.module_from_spec(_spec)
    sys.modules['hermes_cli'] = _m
    _spec.loader.exec_module(_m)
