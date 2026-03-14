"""Recursive descent parser for Lua table literals (read-only, no lupa dependency).

Handles the subset of Lua syntax produced by KOReader:
- Tables: ``{key = value, ["key"] = value, [1] = value, value, ...}``
- Strings: quoted with escapes and long-string ``[[ ]]`` / ``[=[ ]=]`` forms
- Numbers: integers, floats, negatives, hex (0x...)
- Booleans: ``true`` / ``false``
- ``nil``
- Single-line comments ``-- ...`` and long comments ``--[[ ... ]]``
- Top-level ``return <value>`` and ``local IDENT = <value> return IDENT`` wrappers
"""

from __future__ import annotations

from typing import Any


class LuaParseError(Exception):
    """Raised when the Lua source cannot be parsed."""


class _Parser:
    """Stateful recursive-descent parser.  Operates on a Unicode string."""

    def __init__(self, text: str) -> None:
        self._src = text
        self._pos = 0

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def parse(self) -> Any:
        self._skip_whitespace_and_comments()
        value = self._parse_top_level()
        self._skip_whitespace_and_comments()
        if self._pos < len(self._src):
            # Allow trailing content only if it's just whitespace / comments
            remaining = self._src[self._pos :]
            if remaining.strip():
                raise LuaParseError(
                    f"Unexpected content at position {self._pos}: {remaining[:20]!r}"
                )
        return value

    # ------------------------------------------------------------------
    # Top-level: handle "local X = ... return X" and "return ..."
    # ------------------------------------------------------------------

    def _parse_top_level(self) -> Any:
        # "local IDENT = <value> return IDENT"
        if self._match_keyword("local"):
            self._skip_whitespace_and_comments()
            ident = self._parse_identifier()
            self._skip_whitespace_and_comments()
            self._expect("=")
            self._skip_whitespace_and_comments()
            value = self._parse_value()
            self._skip_whitespace_and_comments()
            if self._match_keyword("return"):
                self._skip_whitespace_and_comments()
                ret_ident = self._parse_identifier()
                if ret_ident != ident:
                    raise LuaParseError(
                        f"'return' refers to '{ret_ident}' but bound name is '{ident}'"
                    )
            return value

        # "return <value>"
        if self._match_keyword("return"):
            self._skip_whitespace_and_comments()
            return self._parse_value()

        # Bare value (e.g. just a table literal)
        return self._parse_value()

    # ------------------------------------------------------------------
    # Value dispatch
    # ------------------------------------------------------------------

    def _parse_value(self) -> Any:
        self._skip_whitespace_and_comments()
        ch = self._peek()
        if ch is None:
            raise LuaParseError(f"Unexpected end of input at position {self._pos}")

        if ch == "{":
            return self._parse_table()
        if ch in ('"', "'"):
            return self._parse_short_string()
        if ch == "[" and self._peek_long_string_level() is not None:
            return self._parse_long_string()
        if ch == "-" and self._peek2() == "-":
            # This shouldn't happen because _skip_whitespace_and_comments consumed it,
            # but guard anyway.
            raise LuaParseError(f"Unexpected comment at position {self._pos}")
        if ch in "-0123456789" or (ch == "0" and self._peek2() in ("x", "X")):
            return self._parse_number()
        # Try booleans / nil
        for keyword, val in (("true", True), ("false", False), ("nil", None)):
            if self._src[self._pos : self._pos + len(keyword)] == keyword:
                # Make sure it's not part of a longer identifier
                after = self._pos + len(keyword)
                if after >= len(self._src) or not (
                    self._src[after].isalnum() or self._src[after] == "_"
                ):
                    self._pos += len(keyword)
                    return val
        # Numbers that start with a digit (fallthrough from above ch check)
        if ch.isdigit():
            return self._parse_number()

        raise LuaParseError(f"Unexpected character {ch!r} at position {self._pos}")

    # ------------------------------------------------------------------
    # Table
    # ------------------------------------------------------------------

    def _parse_table(self) -> dict[Any, Any]:
        self._expect("{")
        result: dict[Any, Any] = {}
        auto_index = 1  # 1-based array index for positional values

        while True:
            self._skip_whitespace_and_comments()
            ch = self._peek()
            if ch == "}":
                self._pos += 1
                break
            if ch is None:
                raise LuaParseError("Unterminated table (missing '}')")

            key, value = self._parse_field(auto_index)
            if key == auto_index and isinstance(key, int):
                # Positional entry — increment auto index
                auto_index += 1
            result[key] = value

            self._skip_whitespace_and_comments()
            sep = self._peek()
            if sep in (",", ";"):
                self._pos += 1
            elif sep == "}":
                pass  # trailing comma optional — will break on next iteration
            else:
                # No separator is valid only immediately before '}'
                pass

        return result

    def _parse_field(self, auto_index: int) -> tuple[Any, Any]:
        """Parse one table field and return (key, value)."""
        self._skip_whitespace_and_comments()
        ch = self._peek()

        # [expr] = value  (explicit key)
        if ch == "[":
            # Could be a long-string key OR [expr] = value
            level = self._peek_long_string_level()
            if level is not None:
                # long string used as key (unusual but valid)
                key = self._parse_long_string()
            else:
                self._pos += 1  # consume '['
                self._skip_whitespace_and_comments()
                key = self._parse_value()
                self._skip_whitespace_and_comments()
                self._expect("]")
            self._skip_whitespace_and_comments()
            self._expect("=")
            self._skip_whitespace_and_comments()
            value = self._parse_value()
            return key, value

        # ident = value  (bare identifier key)
        if ch is not None and (ch.isalpha() or ch == "_"):
            # Peek ahead to see if this is "ident =" vs a bare value (true/false/nil)
            saved_pos = self._pos
            ident = self._parse_identifier()
            self._skip_whitespace_and_comments()
            if self._peek() == "=":
                # But make sure it's "=" not "=="
                if self._src[self._pos : self._pos + 2] != "==":
                    self._pos += 1  # consume '='
                    self._skip_whitespace_and_comments()
                    value = self._parse_value()
                    return ident, value
            # Not a key=value pair — restore and treat as positional value
            self._pos = saved_pos

        # Positional value
        value = self._parse_value()
        return auto_index, value

    # ------------------------------------------------------------------
    # Strings
    # ------------------------------------------------------------------

    def _parse_short_string(self) -> str:
        quote = self._src[self._pos]
        self._pos += 1
        parts: list[str] = []
        while self._pos < len(self._src):
            ch = self._src[self._pos]
            if ch == quote:
                self._pos += 1
                return "".join(parts)
            if ch == "\\":
                parts.append(self._parse_escape())
            elif ch in ("\n", "\r"):
                raise LuaParseError(f"Unescaped newline in short string at position {self._pos}")
            else:
                parts.append(ch)
                self._pos += 1
        raise LuaParseError("Unterminated string literal")

    def _parse_escape(self) -> str:
        """Parse a backslash escape sequence; ``self._pos`` points at ``\\``."""
        self._pos += 1  # skip '\'
        if self._pos >= len(self._src):
            raise LuaParseError("Unexpected end of input after '\\'")
        ch = self._src[self._pos]
        self._pos += 1
        simple = {
            "a": "\a",
            "b": "\b",
            "f": "\f",
            "n": "\n",
            "r": "\r",
            "t": "\t",
            "v": "\v",
            "\\": "\\",
            "'": "'",
            '"': '"',
            "\n": "\n",
            "\r": "\n",
        }
        if ch in simple:
            return simple[ch]
        # Decimal escape \ddd (1–3 digits)
        if ch.isdigit():
            digits = ch
            for _ in range(2):
                if self._pos < len(self._src) and self._src[self._pos].isdigit():
                    digits += self._src[self._pos]
                    self._pos += 1
            code = int(digits)
            if code > 255:
                raise LuaParseError(f"Decimal escape \\{digits} out of range")
            return chr(code)
        # Hex escape \xXX (Lua 5.2+)
        if ch == "x":
            hex_digits = ""
            for _ in range(2):
                if self._pos < len(self._src) and self._src[self._pos] in "0123456789abcdefABCDEF":
                    hex_digits += self._src[self._pos]
                    self._pos += 1
                else:
                    raise LuaParseError("Invalid hex escape sequence")
            return chr(int(hex_digits, 16))
        # \z — skip following whitespace (Lua 5.2+)
        if ch == "z":
            while self._pos < len(self._src) and self._src[self._pos] in " \t\n\r\f\v":
                self._pos += 1
            return ""
        raise LuaParseError(f"Unknown escape sequence '\\{ch}' at position {self._pos}")

    def _peek_long_string_level(self) -> int | None:
        """Return the nesting level if the current position starts a long string/comment bracket.

        Returns the number of '=' signs in the opening bracket, or None if not at one.
        """
        i = self._pos
        if i >= len(self._src) or self._src[i] != "[":
            return None
        i += 1
        level = 0
        while i < len(self._src) and self._src[i] == "=":
            level += 1
            i += 1
        if i < len(self._src) and self._src[i] == "[":
            return level
        return None

    def _parse_long_string(self) -> str:
        """Parse ``[=*[ ... ]=*]`` long strings.  ``self._pos`` points at first ``[``."""
        level = self._peek_long_string_level()
        if level is None:
            raise LuaParseError(f"Expected long string at position {self._pos}")
        # Consume opening bracket [=*[
        self._pos += 2 + level  # '[' + '='*level + '['
        # Skip immediate newline after opening bracket (Lua spec)
        if self._pos < len(self._src) and self._src[self._pos] == "\n":
            self._pos += 1
        elif self._pos + 1 < len(self._src) and self._src[self._pos : self._pos + 2] == "\r\n":
            self._pos += 2
        elif self._pos < len(self._src) and self._src[self._pos] == "\r":
            self._pos += 1

        closing = "]" + "=" * level + "]"
        end = self._src.find(closing, self._pos)
        if end == -1:
            raise LuaParseError(
                f"Unterminated long string (expected {closing!r})"
                f" starting near position {self._pos}"
            )
        content = self._src[self._pos : end]
        self._pos = end + len(closing)
        return content

    # ------------------------------------------------------------------
    # Numbers
    # ------------------------------------------------------------------

    def _parse_number(self) -> int | float:
        start = self._pos
        src = self._src

        # Optional leading minus
        if self._pos < len(src) and src[self._pos] == "-":
            self._pos += 1

        # Hex
        if self._pos + 1 < len(src) and src[self._pos : self._pos + 2] in ("0x", "0X"):
            self._pos += 2
            _hex_start = self._pos
            while self._pos < len(src) and src[self._pos] in "0123456789abcdefABCDEF_":
                self._pos += 1
            token = src[start : self._pos].replace("_", "")
            try:
                return int(token, 16)
            except ValueError:
                raise LuaParseError(f"Invalid hex number: {token!r}")

        # Integer or float
        while self._pos < len(src) and (src[self._pos].isdigit() or src[self._pos] == "_"):
            self._pos += 1
        is_float = False
        if self._pos < len(src) and src[self._pos] == ".":
            # Make sure it's not ".." (range operator) — irrelevant here but safe
            if self._pos + 1 < len(src) and src[self._pos + 1] == ".":
                pass  # range op, stop before it
            else:
                is_float = True
                self._pos += 1
                while self._pos < len(src) and (src[self._pos].isdigit() or src[self._pos] == "_"):
                    self._pos += 1
        # Exponent
        if self._pos < len(src) and src[self._pos] in ("e", "E"):
            is_float = True
            self._pos += 1
            if self._pos < len(src) and src[self._pos] in ("+", "-"):
                self._pos += 1
            exp_start = self._pos
            while self._pos < len(src) and src[self._pos].isdigit():
                self._pos += 1
            if self._pos == exp_start:
                raise LuaParseError(f"Invalid exponent in number at position {self._pos}")

        token = src[start : self._pos].replace("_", "")
        if not token or token in ("-", "+"):
            raise LuaParseError(f"Expected number at position {start}")
        try:
            if is_float:
                return float(token)
            return int(token)
        except ValueError:
            raise LuaParseError(f"Invalid number token: {token!r}")

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _parse_identifier(self) -> str:
        start = self._pos
        src = self._src
        if self._pos >= len(src) or not (src[self._pos].isalpha() or src[self._pos] == "_"):
            raise LuaParseError(
                f"Expected identifier at position {self._pos},"
                f" got {src[self._pos : self._pos + 5]!r}"
            )
        while self._pos < len(src) and (src[self._pos].isalnum() or src[self._pos] == "_"):
            self._pos += 1
        return src[start : self._pos]

    def _match_keyword(self, keyword: str) -> bool:
        """Consume *keyword* if it appears at the current position.

        Returns False if the keyword is followed by identifier characters
        (i.e. it is part of a longer name).
        """
        end = self._pos + len(keyword)
        if self._src[self._pos : end] != keyword:
            return False
        # Make sure it's not a longer identifier
        if end < len(self._src) and (self._src[end].isalnum() or self._src[end] == "_"):
            return False
        self._pos = end
        return True

    def _expect(self, char: str) -> None:
        if self._pos >= len(self._src) or self._src[self._pos] != char:
            got = self._src[self._pos : self._pos + 5] if self._pos < len(self._src) else "<EOF>"
            raise LuaParseError(f"Expected {char!r} at position {self._pos}, got {got!r}")
        self._pos += 1

    def _peek(self) -> str | None:
        if self._pos < len(self._src):
            return self._src[self._pos]
        return None

    def _peek2(self) -> str | None:
        if self._pos + 1 < len(self._src):
            return self._src[self._pos + 1]
        return None

    def _skip_whitespace_and_comments(self) -> None:
        src = self._src
        n = len(src)
        while self._pos < n:
            ch = src[self._pos]
            # Whitespace
            if ch in " \t\n\r\f\v":
                self._pos += 1
                continue
            # Comments start with '--'
            if ch == "-" and self._pos + 1 < n and src[self._pos + 1] == "-":
                self._pos += 2
                # Long comment?
                level = self._peek_long_string_level()
                if level is not None:
                    self._parse_long_string()
                else:
                    # Single-line comment: skip to end of line
                    while self._pos < n and src[self._pos] not in ("\n", "\r"):
                        self._pos += 1
                continue
            break


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_lua(text: str) -> Any:
    """Parse a Lua value (table, string, number, bool, nil) from *text*.

    Understands the KOReader file patterns::

        local Page = { ... }
        return Page

    and::

        return { ... }

    Raises :class:`LuaParseError` on any parse failure.
    """
    return _Parser(text).parse()
