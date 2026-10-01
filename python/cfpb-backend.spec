# PyInstaller spec for the cfpb-backend sidecar (`npm run backend:build`).
#
# onedir, not onefile: onefile unpacks the interpreter to a temp dir on every
# launch, and Windows Defender distrusts onefile output as a class.

from PyInstaller.utils.hooks import collect_all, collect_data_files

# collect_data_files, not collect_all: collect_all enumerates cfengine_cli.main,
# which imports cf_remote and drags in ~27 MB of libcloud drivers.
datas = collect_data_files("cfengine_cli") + collect_data_files("cfbs")
# The block descriptors the compiler reads (see cfpb_compiler.blocks_dir).
datas += [("../blocks/*.json", "blocks"), ("../blocks/lib/*.json", "blocks/lib")]
binaries = []

# Compiled extension modules and the CFEngine grammar — invisible to static analysis.
for package in ("tree_sitter", "tree_sitter_cfengine"):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries

# Named so a missing module fails the build, not the packaged app.
# cfbs.main is imported lazily by `init`; its own imports are all static.
hiddenimports = ["cfengine_cli.format", "cfengine_cli.lint", "cfbs.main", "cfbs.pretty"]

a = Analysis(
    ["cfpb_backend.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Headless sidecar: no GUI toolkit, test framework, or cloud drivers. Tens of MB each.
    #
    # Fragile by upstream design: cfengine_cli/__init__.py os.listdir()s its own
    # directory and __import__s every .py it finds, including main.py -> cf_remote
    # -> libcloud. These excludes only hold because the PYZ leaves no .py files on
    # disk for listdir to see. Anything that materialises them — noarchive=True,
    # collect_all("cfengine_cli") instead of collect_data_files, upstream shipping
    # .py files as data — makes the packaged app die on import while dev keeps
    # working.
    excludes=["tkinter", "pytest", "IPython", "cf_remote", "libcloud"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="cfpb-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX invalidates macOS code signatures
    console=True,  # payload arrives on stdin, result leaves on stdout
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="cfpb-backend",
)
