# PyInstaller spec for the cfpb-backend sidecar (`npm run backend:build`).
#
# onedir, not onefile: onefile unpacks the interpreter to a temp dir on every
# launch, and Windows Defender distrusts onefile output as a class.

from PyInstaller.utils.hooks import collect_all, collect_data_files

# collect_data_files, not collect_all: only the packages' data, no module sweep.
datas = collect_data_files("cfengine_cli") + collect_data_files("cfbs")
# cf-remote deploy copies its nt-discovery.sh to the hub.
datas += collect_data_files("cf_remote")
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
hiddenimports = ["cfengine_cli.format", "cfengine_cli.lint", "cfbs.main", "cfbs.pretty", "cf_remote.commands"]

a = Analysis(
    ["cfpb_backend.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Headless sidecar: no GUI toolkit or test framework. Tens of MB each.
    # cf_remote stays, for deploying: it brings ~27 MB of libcloud drivers along.
    excludes=["tkinter", "pytest", "IPython"],
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
