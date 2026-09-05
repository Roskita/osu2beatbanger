import argparse
from pathlib import Path

from .converter import convert_osz


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert an osu!mania 4K .osz to a Beat Banger mod."
    )

    parser.add_argument(
        "osz",
        type=Path,
        help="Path to the osu!mania .osz file",
    )

    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("output.zip"),
        help="Output Beat Banger mod ZIP",
    )

    args = parser.parse_args()

    result = convert_osz(
        args.osz,
        args.output,
    )

    print(result)


if __name__ == "__main__":
    main()