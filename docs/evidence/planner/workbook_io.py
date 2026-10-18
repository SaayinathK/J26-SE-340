"""Small OOXML reader/writer: retain all original export sheets byte-for-byte.

Only workbook metadata/styles are extended; new review sheets use inline strings.
No Excel automation, macros, network requests, or external Python packages.
"""
import copy
import posixpath
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr
from zipfile import ZIP_DEFLATED, ZipFile

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"s": MAIN}


def col(number):
    text = ""
    while number:
        number, digit = divmod(number - 1, 26)
        text = chr(65 + digit) + text
    return text


def read_workbook(path):
    sheets = []
    with ZipFile(path) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(t.text or "" for t in item.findall(".//s:t", NS))
                       for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS)]
        relations = {r.attrib["Id"]: r.attrib["Target"]
                     for r in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        for sheet in ET.fromstring(archive.read("xl/workbook.xml")).findall("s:sheets/s:sheet", NS):
            target = relations[sheet.attrib[f"{{{REL}}}id"]]
            part = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            rows = []
            for row in ET.fromstring(archive.read(part)).findall("s:sheetData/s:row", NS):
                values = {}
                for cell in row.findall("s:c", NS):
                    kind = cell.attrib.get("t")
                    if kind == "inlineStr":
                        value = "".join(t.text or "" for t in cell.findall("s:is//s:t", NS))
                    else:
                        element = cell.find("s:v", NS)
                        value = element.text or "" if element is not None else ""
                        if kind == "s" and value:
                            value = strings[int(value)]
                    values[re.sub(r"\d", "", cell.attrib["r"])] = value
                if any(values.values()):
                    rows.append({"row": int(row.attrib["r"]), "cells": values})
            sheets.append({"name": sheet.attrib["name"], "part": part, "rows": rows})
    return sheets


def table_records(sheet):
    headers = sheet["rows"][0]["cells"]
    return [{"_row": row["row"], **{header: row["cells"].get(letter, "") for letter, header in headers.items()}}
            for row in sheet["rows"][1:]]


def extend_collection(xml, tag, fragments):
    pattern = rf"(<{tag}\b[^>]*\bcount=\")(\d+)(\"[^>]*>)(.*?)(</{tag}>)"
    def replace(match):
        return match[1] + str(int(match[2]) + len(fragments)) + match[3] + match[4] + "".join(fragments) + match[5]
    result, count = re.subn(pattern, replace, xml, count=1, flags=re.S)
    if count != 1:
        raise ValueError("Cannot extend styles collection: " + tag)
    return result


def extend_styles(xml):
    style_root = ET.fromstring(xml)
    font_count = len(style_root.find("s:fonts", NS))
    fill_count = len(style_root.find("s:fills", NS))
    style_count = len(style_root.find("s:cellXfs", NS))
    xml = extend_collection(xml, "fonts", ['<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'])
    colors = ["FF17365D", "FFE2F0D9", "FFFFF2CC", "FFFCE4D6", "FFE7E6E6"]
    xml = extend_collection(xml, "fills", [f'<fill><patternFill patternType="solid"><fgColor rgb="{color}"/><bgColor indexed="64"/></patternFill></fill>' for color in colors])
    def style(font=0, fill=0):
        return f'<xf numFmtId="0" fontId="{font}" fillId="{fill}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
    xml = extend_collection(xml, "cellXfs", [style(), style(font_count, fill_count), *[style(0, fill_count + i) for i in range(1, 5)]])
    return xml, {"normal": style_count, "header": style_count + 1, "green": style_count + 2,
                 "yellow": style_count + 3, "red": style_count + 4, "gray": style_count + 5}


def sheet_xml(headers, rows, widths, styles, status_column=None, links=None):
    links = links or {}
    parts = [f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="{MAIN}" xmlns:r="{REL}">',
             f'<dimension ref="A1:{col(len(headers))}{len(rows) + 1}"/>',
             '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>',
             '<sheetFormatPr defaultRowHeight="18"/><cols>']
    for i, width in enumerate(widths, 1):
        parts.append(f'<col min="{i}" max="{i}" width="{width}" customWidth="1"/>')
    parts.append('</cols><sheetData>')
    for row_number, row in enumerate([headers] + rows, 1):
        max_lines = max((len(str(value).splitlines()) for value in row), default=1)
        height = 32 if row_number == 1 else min(180, max(42, max_lines * 15))
        parts.append(f'<row r="{row_number}" ht="{height}" customHeight="1">')
        for number, value in enumerate(row, 1):
            value = "" if value is None else str(value)
            if len(value) > 32767:
                raise ValueError(f"Cell too long at {col(number)}{row_number}")
            value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value)
            style = styles["header"] if row_number == 1 else styles["normal"]
            if row_number > 1 and number == status_column:
                if value in ("Completed", "Verified", "Passed"):
                    style = styles["green"]
                elif value in ("In progress", "Partial", "Export reported only", "Implemented; live test pending"):
                    style = styles["yellow"]
                elif value in ("Failed", "Blocked", "Pending"):
                    style = styles["red"]
                elif value == "Not started":
                    style = styles["gray"]
            parts.append(f'<c r="{col(number)}{row_number}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>')
        parts.append('</row>')
    parts.append(f'</sheetData><autoFilter ref="A1:{col(len(headers))}{len(rows) + 1}"/>')
    rels = []
    if links:
        parts.append('<hyperlinks>')
        for index, (cell, target) in enumerate(links.items(), 1):
            rid = f'rIdLink{index}'
            parts.append(f'<hyperlink ref="{cell}" r:id="{rid}"/>')
            rels.append(f'<Relationship Id="{rid}" Type="{REL}/hyperlink" Target={quoteattr(target)} TargetMode="External"/>')
        parts.append('</hyperlinks>')
    parts.append('<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>')
    relationships = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(rels) + '</Relationships>'
    return ''.join(parts).encode('utf-8'), relationships.encode('utf-8') if rels else None


def add_sheets(source, target, sheets):
    with ZipFile(source) as original:
        parts = {item.filename: original.read(item.filename) for item in original.infolist()}
    workbook = parts["xl/workbook.xml"].decode("utf-8")
    relations = parts["xl/_rels/workbook.xml.rels"].decode("utf-8")
    types = parts["[Content_Types].xml"].decode("utf-8")
    styles_xml, styles = extend_styles(parts["xl/styles.xml"].decode("utf-8"))
    parts["xl/styles.xml"] = styles_xml.encode("utf-8")
    sheet_id = max(int(x.attrib["sheetId"]) for x in ET.fromstring(workbook).findall("s:sheets/s:sheet", NS))
    new_sheet_tags = []
    for number, definition in enumerate(sheets, 1):
        sheet_id += 1
        rid = f"rIdAudit{number}"
        part = f"xl/worksheets/audit{number}.xml"
        data, rel_data = sheet_xml(definition["headers"], definition["rows"], definition["widths"], styles,
                                   definition.get("status_column"), definition.get("links"))
        parts[part] = data
        if rel_data:
            parts[f"xl/worksheets/_rels/audit{number}.xml.rels"] = rel_data
        new_sheet_tags.append(f'<sheet name={quoteattr(definition["name"])} sheetId="{sheet_id}" r:id="{rid}"/>')
        relations = relations.replace('</Relationships>', f'<Relationship Id="{rid}" Type="{REL}/worksheet" Target="worksheets/audit{number}.xml"/></Relationships>')
        types = types.replace('</Types>', f'<Override PartName="/{part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
    workbook = workbook.replace('<sheets>', '<sheets>' + ''.join(new_sheet_tags), 1)
    parts["xl/workbook.xml"] = workbook.encode("utf-8")
    parts["xl/_rels/workbook.xml.rels"] = relations.encode("utf-8")
    parts["[Content_Types].xml"] = types.encode("utf-8")
    # Keep application properties consistent with the added sheets.
    app = ET.fromstring(parts["docProps/app.xml"])
    app_ns = {"a": "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
              "v": "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"}
    vector = app.find("a:TitlesOfParts/v:vector", app_ns)
    if vector is not None:
        originals = list(vector)
        for item in originals:
            vector.remove(item)
        for definition in sheets:
            ET.SubElement(vector, f'{{{app_ns["v"]}}}lpstr').text = definition["name"]
        for item in originals:
            vector.append(copy.deepcopy(item))
        vector.set("size", str(len(vector)))
    heading = app.find("a:HeadingPairs/v:vector", app_ns)
    if heading is not None:
        for variant in heading:
            integer = variant.find("v:i4", app_ns)
            if integer is not None:
                integer.text = str(int(integer.text) + len(sheets))
                break
    parts["docProps/app.xml"] = ET.tostring(app, encoding="utf-8", xml_declaration=True)
    with ZipFile(target, "w", ZIP_DEFLATED) as result:
        for name, content in parts.items():
            result.writestr(name, content)
    validate_workbook(source, target, sheets)


def validate_workbook(source, target, definitions):
    with ZipFile(source) as original, ZipFile(target) as result:
        assert result.testzip() is None
        for name in result.namelist():
            if name.endswith((".xml", ".rels")):
                ET.fromstring(result.read(name))
        for name in original.namelist():
            if name.startswith("xl/worksheets/"):
                assert original.read(name) == result.read(name), f"Original sheet changed: {name}"
        types = {item.attrib.get("PartName", "").lstrip("/") for item in ET.fromstring(result.read("[Content_Types].xml"))}
        for item in ET.fromstring(result.read("xl/_rels/workbook.xml.rels")):
            target_part = posixpath.normpath("xl/" + item.attrib["Target"])
            assert target_part in result.namelist(), target_part
        for i, definition in enumerate(definitions, 1):
            assert f"xl/worksheets/audit{i}.xml" in types
            parsed = ET.fromstring(result.read(f"xl/worksheets/audit{i}.xml"))
            assert len(parsed.findall("s:sheetData/s:row", NS)) == len(definition["rows"]) + 1
    actual = read_workbook(target)
    for expected, observed in zip(definitions, actual):
        assert expected["name"] == observed["name"]
        expected_rows = [expected["headers"]] + expected["rows"]
        for expected_row, actual_row in zip(expected_rows, observed["rows"]):
            assert ["" if value is None else str(value) for value in expected_row] == [actual_row["cells"].get(col(i), "") for i in range(1, len(expected_row) + 1)]
