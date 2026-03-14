"""Comprehensive tests for the Lua table parser (step 2.1)."""

from __future__ import annotations

import pathlib

import pytest

from app.koreader.lua_parser import LuaParseError, parse_lua

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Simple key-value tables
# ---------------------------------------------------------------------------


def test_parse_simple_string_keys():
    result = parse_lua('{ key = "value", other = "hello" }')
    assert result == {"key": "value", "other": "hello"}


def test_parse_bracket_string_keys():
    result = parse_lua('{ ["key"] = "value", ["key2"] = "value2" }')
    assert result == {"key": "value", "key2": "value2"}


def test_parse_mixed_key_styles():
    result = parse_lua('{ bare = 1, ["bracketed"] = 2 }')
    assert result == {"bare": 1, "bracketed": 2}


# ---------------------------------------------------------------------------
# Nested tables
# ---------------------------------------------------------------------------


def test_parse_nested_table():
    src = """
    {
        outer = "top",
        inner = {
            a = 1,
            b = 2,
        },
    }
    """
    result = parse_lua(src)
    assert result["outer"] == "top"
    assert result["inner"] == {"a": 1, "b": 2}


def test_parse_deeply_nested_table():
    src = "{ a = { b = { c = { d = 42 } } } }"
    result = parse_lua(src)
    assert result["a"]["b"]["c"]["d"] == 42


# ---------------------------------------------------------------------------
# Array-style tables
# ---------------------------------------------------------------------------


def test_parse_array_style_integers():
    result = parse_lua("{ 10, 20, 30 }")
    assert result == {1: 10, 2: 20, 3: 30}


def test_parse_array_style_strings():
    result = parse_lua('{ "alpha", "beta", "gamma" }')
    assert result == {1: "alpha", 2: "beta", 3: "gamma"}


def test_parse_array_style_empty():
    result = parse_lua("{ }")
    assert result == {}


def test_parse_array_explicit_integer_keys():
    result = parse_lua("{ [1] = 10, [2] = 20, [3] = 30 }")
    assert result == {1: 10, 2: 20, 3: 30}


# ---------------------------------------------------------------------------
# Mixed tables (numeric and string keys)
# ---------------------------------------------------------------------------


def test_parse_mixed_table():
    src = '{ "positional", key = "named", [3] = "explicit" }'
    result = parse_lua(src)
    assert result[1] == "positional"
    assert result["key"] == "named"
    assert result[3] == "explicit"


# ---------------------------------------------------------------------------
# String escapes
# ---------------------------------------------------------------------------


def test_parse_string_basic_escapes():
    result = parse_lua(r'{ s = "line1\nline2\ttabbed" }')
    assert result["s"] == "line1\nline2\ttabbed"


def test_parse_string_backslash_escape():
    result = parse_lua(r'{ s = "back\\slash" }')
    assert result["s"] == "back\\slash"


def test_parse_string_quote_escape():
    result = parse_lua(r'{ s = "say \"hello\"" }')
    assert result["s"] == 'say "hello"'


def test_parse_string_decimal_escape():
    # \065 == 'A'
    result = parse_lua(r'{ s = "\065BC" }')
    assert result["s"] == "ABC"


def test_parse_single_quoted_string():
    result = parse_lua("{ s = 'hello world' }")
    assert result["s"] == "hello world"


# ---------------------------------------------------------------------------
# Long strings
# ---------------------------------------------------------------------------


def test_parse_long_string_basic():
    src = "{ s = [[hello\nworld]] }"
    result = parse_lua(src)
    assert result["s"] == "hello\nworld"


def test_parse_long_string_with_level():
    src = "{ s = [==[nested [[brackets]] here]==] }"
    result = parse_lua(src)
    assert result["s"] == "nested [[brackets]] here"


def test_parse_long_string_strips_initial_newline():
    src = "{ s = [[\nhello]] }"
    result = parse_lua(src)
    assert result["s"] == "hello"


# ---------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------


def test_parse_integer():
    assert parse_lua("{ n = 42 }") == {"n": 42}


def test_parse_negative_integer():
    assert parse_lua("{ n = -7 }") == {"n": -7}


def test_parse_float():
    assert parse_lua("{ n = 3.14 }") == {"n": pytest.approx(3.14)}


def test_parse_negative_float():
    assert parse_lua("{ n = -0.5 }") == {"n": pytest.approx(-0.5)}


def test_parse_float_exponent():
    assert parse_lua("{ n = 1.5e3 }") == {"n": pytest.approx(1500.0)}


def test_parse_hex_number():
    assert parse_lua("{ n = 0xFF }") == {"n": 255}


def test_parse_large_integer_key():
    # KOReader uses Unix timestamps as keys in performance_in_pages
    result = parse_lua("{ [1705359000] = 30 }")
    assert result[1705359000] == 30


# ---------------------------------------------------------------------------
# Booleans and nil
# ---------------------------------------------------------------------------


def test_parse_true():
    assert parse_lua("{ b = true }") == {"b": True}


def test_parse_false():
    assert parse_lua("{ b = false }") == {"b": False}


def test_parse_nil():
    assert parse_lua("{ v = nil }") == {"v": None}


def test_parse_booleans_in_array():
    result = parse_lua("{ true, false, true }")
    assert result == {1: True, 2: False, 3: True}


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


def test_parse_single_line_comment():
    src = """
    {
        -- this is a comment
        key = "value", -- trailing comment
    }
    """
    assert parse_lua(src) == {"key": "value"}


def test_parse_long_comment():
    src = """
    --[[ This is a
         multi-line comment ]]
    { key = "value" }
    """
    assert parse_lua(src) == {"key": "value"}


# ---------------------------------------------------------------------------
# Top-level wrappers
# ---------------------------------------------------------------------------


def test_parse_return_table():
    src = "return { key = 1 }"
    assert parse_lua(src) == {"key": 1}


def test_parse_local_assign_return():
    src = """
    local Page = { key = "hello" }
    return Page
    """
    assert parse_lua(src) == {"key": "hello"}


def test_parse_local_assign_return_different_name_raises():
    src = """
    local X = { key = 1 }
    return Y
    """
    with pytest.raises(LuaParseError):
        parse_lua(src)


# ---------------------------------------------------------------------------
# Semicolons as field separators
# ---------------------------------------------------------------------------


def test_parse_semicolon_separator():
    result = parse_lua("{ a = 1; b = 2; c = 3 }")
    assert result == {"a": 1, "b": 2, "c": 3}


# ---------------------------------------------------------------------------
# Real-world KOReader fixtures
# ---------------------------------------------------------------------------


def test_parse_metadata_lua_fixture():
    """Parse the real-format metadata.epub.lua fixture (return { ... } style)."""
    src = (FIXTURES_DIR / "metadata.epub.lua").read_text(encoding="utf-8")
    result = parse_lua(src)

    # Top-level fields in real KOReader format
    assert result["partial_md5_checksum"] == "abc123def456abc1"
    assert result["percent_finished"] == pytest.approx(0.73)
    assert result["doc_pages"] == 1258
    assert result["last_xpointer"].startswith("/body/")

    # doc_props nested table
    doc_props = result["doc_props"]
    assert doc_props["authors"] == "Brandon Sanderson"
    assert doc_props["title"] == "The Way of Kings"
    assert doc_props["language"] == "en"

    # stats nested table
    stats = result["stats"]
    assert stats["title"] == "The Way of Kings"
    assert stats["total_time_in_sec"] == 72000
    perf = stats["performance_in_pages"]
    assert isinstance(perf, dict)
    assert perf[1705359000] == 30

    # summary
    summary = result["summary"]
    assert summary["status"] == "reading"

    # annotations
    annotations = result["annotations"]
    assert isinstance(annotations, dict)
    ann1 = annotations[1]
    assert ann1["text"] == "Life before death."
    assert ann1["note"] == "Interesting motto"
    assert ann1["chapter"] == "Prelude to the Stormlight Archive"
    assert ann1["datetime"] == "2024-01-15 20:30:00"


def test_parse_stats_lua_fixture():
    src = (FIXTURES_DIR / "stats.lua").read_text(encoding="utf-8")
    result = parse_lua(src)

    assert result["title"] == "The Way of Kings"
    assert result["authors"] == "Brandon Sanderson"
    assert result["total_time_in_sec"] == 72000
    assert result["pages"] == 1258

    perf = result["performance_in_pages"]
    assert isinstance(perf, dict)
    assert perf[1705359000] == 30
    assert perf[1705359060] == 25
    assert perf[1705365600] == 45


# ---------------------------------------------------------------------------
# Malformed input → LuaParseError
# ---------------------------------------------------------------------------


def test_malformed_unterminated_table():
    with pytest.raises(LuaParseError):
        parse_lua("{ key = 1")


def test_malformed_unterminated_string():
    with pytest.raises(LuaParseError):
        parse_lua('{ key = "unterminated }')


def test_malformed_missing_value():
    with pytest.raises(LuaParseError):
        parse_lua("{ key = }")


def test_malformed_unexpected_character():
    with pytest.raises(LuaParseError):
        parse_lua("@invalid")


def test_malformed_unterminated_long_string():
    with pytest.raises(LuaParseError):
        parse_lua("{ s = [[ never closed }")


def test_malformed_extra_content_after_value():
    with pytest.raises(LuaParseError):
        parse_lua("{ key = 1 } extra garbage here")


def test_malformed_empty_input():
    with pytest.raises(LuaParseError):
        parse_lua("")


def test_malformed_invalid_hex_number():
    with pytest.raises(LuaParseError):
        parse_lua("{ n = 0x }")


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_parse_nested_tables_in_array():
    src = "{ { a = 1 }, { b = 2 } }"
    result = parse_lua(src)
    assert result[1] == {"a": 1}
    assert result[2] == {"b": 2}


def test_parse_trailing_comma():
    result = parse_lua("{ a = 1, b = 2, }")
    assert result == {"a": 1, "b": 2}


def test_parse_zero():
    assert parse_lua("{ n = 0 }") == {"n": 0}


def test_parse_bare_value_true():
    # Bare boolean at top level with return
    assert parse_lua("return true") is True


def test_parse_bare_value_string():
    assert parse_lua('return "hello"') == "hello"


def test_parse_unicode_string_content():
    result = parse_lua('{ s = "Stra\xdfe" }')
    assert result["s"] == "Stra\xdfe"


def test_parse_float_without_leading_zero():
    # ".5" is not valid Lua — but "0.5" is.  Make sure 0.5 parses fine.
    assert parse_lua("{ n = 0.5 }") == {"n": pytest.approx(0.5)}


def test_parse_negative_float_in_array():
    result = parse_lua("{ -1.5, 2.5, -3.0 }")
    assert result[1] == pytest.approx(-1.5)
    assert result[2] == pytest.approx(2.5)
    assert result[3] == pytest.approx(-3.0)
