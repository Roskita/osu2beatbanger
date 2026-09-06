import argparse
import sys
from pathlib import Path

from .bb_schema import sanitize_filename
from .bb_to_osu import convert_bb_to_osz
from .osu_to_bb import convert_osz


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:  # noqa: BLE001 - top-level CLI boundary, intentional
        print(f"ERROR: unexpected failure: {e}", file=sys.stderr)
        sys.exit(1)


def _cmd_to_bb(args: argparse.Namespace) -> None:
    output = args.output
    if output is None:
        output = Path(f"{sanitize_filename(args.osz.stem)}.zip")
    result = _run(convert_osz, args.osz, output)
    print(result)


def _cmd_to_osu(args: argparse.Namespace) -> None:
    output_dir = args.output or Path(".")
    results = _run(convert_bb_to_osz, args.mod, output_dir)
    for path in results:
        print(path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert osu!mania 4K maps to Beat Banger mods, and back."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    to_bb = subparsers.add_parser("to-bb", help="Convert an osu!mania .osz into a Beat Banger mod")
    to_bb.add_argument("osz", type=Path, help="Path to the osu!mania .osz file")
    to_bb.add_argument(
        "-o", "--output", type=Path, default=None,
        help="Output Beat Banger mod ZIP (default: <input filename>.zip)",
    )
    to_bb.set_defaults(func=_cmd_to_bb)

    to_osu = subparsers.add_parser("to-osu", help="Convert a Beat Banger mod back into osu!mania .osz file(s)")
    to_osu.add_argument("mod", type=Path, help="Path to a Beat Banger mod folder or zip")
    to_osu.add_argument(
        "-o", "--output", type=Path, default=None,
        help="Output directory for the generated .osz file(s) (default: current directory)",
    )
    to_osu.set_defaults(func=_cmd_to_osu)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
