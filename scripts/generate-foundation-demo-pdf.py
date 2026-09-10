#!/usr/bin/env python3

from pathlib import Path

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "informe-ejecutivo-nova-finanzas.pdf"

INK = colors.HexColor("#17191C")
MUTED = colors.HexColor("#626872")
LINE = colors.HexColor("#E4E7EB")
PANEL = colors.HexColor("#F5F6F8")
BLUE = colors.HexColor("#2E6BFF")
GREEN = colors.HexColor("#0B8F62")
RED = colors.HexColor("#D64545")
AMBER = colors.HexColor("#D88718")
WHITE = colors.white


def money(value: float) -> str:
    return f"MXN {value:,.0f}"


def pct(value: float) -> str:
    return f"{value:+.2f}%"


def page_chrome(canvas, doc):
    width, height = A4
    canvas.saveState()
    canvas.setFillColor(INK)
    canvas.rect(0, height - 13 * mm, width, 13 * mm, stroke=0, fill=1)
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(18 * mm, height - 8.5 * mm, "FOUNDATION")
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(width - 18 * mm, height - 8.5 * mm, "NOVA FINANZAS  |  CONTROL DE GASTOS Q3")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 15 * mm, width - 18 * mm, 15 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(18 * mm, 10 * mm, "Datos ficticios para demostración")
    canvas.drawRightString(width - 18 * mm, 10 * mm, f"Pagina {doc.page}")
    canvas.restoreState()


def metric_card(label, value, note, value_color=INK):
    styles = get_styles()
    return Table(
        [[Paragraph(label, styles["metric_label"])],
         [Paragraph(value, ParagraphStyle("metric_value_dynamic", parent=styles["metric_value"], textColor=value_color))],
         [Paragraph(note, styles["metric_note"])]],
        colWidths=[53 * mm],
        rowHeights=[7 * mm, 11 * mm, 8 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), PANEL),
            ("BOX", (0, 0), (-1, -1), 0.5, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]),
    )


def get_styles():
    base = getSampleStyleSheet()
    return {
        "eyebrow": ParagraphStyle(
            "eyebrow", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=8, leading=10, textColor=BLUE, spaceAfter=4, uppercase=True,
        ),
        "title": ParagraphStyle(
            "title", parent=base["Title"], fontName="Helvetica-Bold",
            fontSize=25, leading=29, textColor=INK, alignment=TA_LEFT, spaceAfter=4,
        ),
        "subtitle": ParagraphStyle(
            "subtitle", parent=base["Normal"], fontName="Helvetica",
            fontSize=10.5, leading=15, textColor=MUTED, spaceAfter=12,
        ),
        "section": ParagraphStyle(
            "section", parent=base["Heading2"], fontName="Helvetica-Bold",
            fontSize=14, leading=18, textColor=INK, spaceBefore=7, spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body", parent=base["BodyText"], fontName="Helvetica",
            fontSize=9.4, leading=14, textColor=INK, spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "small", parent=base["BodyText"], fontName="Helvetica",
            fontSize=8, leading=11, textColor=MUTED,
        ),
        "callout": ParagraphStyle(
            "callout", parent=base["BodyText"], fontName="Helvetica-Bold",
            fontSize=10, leading=15, textColor=INK,
        ),
        "metric_label": ParagraphStyle(
            "metric_label", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=7.5, leading=9, textColor=MUTED,
        ),
        "metric_value": ParagraphStyle(
            "metric_value", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=15.5, leading=17, textColor=INK,
        ),
        "metric_note": ParagraphStyle(
            "metric_note", parent=base["Normal"], fontName="Helvetica",
            fontSize=7.5, leading=9, textColor=MUTED,
        ),
        "table_header": ParagraphStyle(
            "table_header", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=7.5, leading=9, textColor=WHITE,
        ),
        "table_cell": ParagraphStyle(
            "table_cell", parent=base["Normal"], fontName="Helvetica",
            fontSize=8.3, leading=10, textColor=INK,
        ),
        "table_cell_right": ParagraphStyle(
            "table_cell_right", parent=base["Normal"], fontName="Helvetica",
            fontSize=8.3, leading=10, textColor=INK, alignment=TA_RIGHT,
        ),
        "table_total": ParagraphStyle(
            "table_total", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=8.3, leading=10, textColor=INK,
        ),
        "table_total_right": ParagraphStyle(
            "table_total_right", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=8.3, leading=10, textColor=INK, alignment=TA_RIGHT,
        ),
        "check": ParagraphStyle(
            "check", parent=base["BodyText"], fontName="Helvetica",
            fontSize=8.3, leading=12, textColor=INK, leftIndent=13, firstLineIndent=-13, spaceAfter=4,
        ),
    }


def spend_chart():
    drawing = Drawing(168 * mm, 48 * mm)
    chart = VerticalBarChart()
    chart.x = 10 * mm
    chart.y = 8 * mm
    chart.height = 31 * mm
    chart.width = 150 * mm
    chart.data = [[82400, 91750, 88300], [90000, 90000, 90000]]
    chart.categoryAxis.categoryNames = ["Julio", "Agosto", "Septiembre"]
    chart.categoryAxis.labels.fontName = "Helvetica"
    chart.categoryAxis.labels.fontSize = 7.5
    chart.valueAxis.valueMin = 0
    chart.valueAxis.valueMax = 100000
    chart.valueAxis.valueStep = 25000
    chart.valueAxis.labels.fontName = "Helvetica"
    chart.valueAxis.labels.fontSize = 6.5
    chart.valueAxis.labelTextFormat = lambda v: f"{int(v / 1000)}k"
    chart.bars[0].fillColor = BLUE
    chart.bars[1].fillColor = colors.HexColor("#C9CED6")
    chart.bars.strokeColor = None
    chart.barWidth = 11 * mm
    chart.groupSpacing = 14
    drawing.add(chart)
    drawing.add(String(16 * mm, 43 * mm, "Gasto real", fontName="Helvetica-Bold", fontSize=7.5, fillColor=BLUE))
    drawing.add(String(50 * mm, 43 * mm, "Presupuesto", fontName="Helvetica-Bold", fontSize=7.5, fillColor=colors.HexColor("#8A9099")))
    return drawing


def build_pdf():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = get_styles()
    width, height = A4
    frame = Frame(18 * mm, 18 * mm, width - 36 * mm, height - 36 * mm, leftPadding=0, rightPadding=0, topPadding=4 * mm, bottomPadding=3 * mm)
    doc = BaseDocTemplate(
        str(OUTPUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title="Informe ejecutivo de variación presupuestaria",
        author="Nova Finanzas - generado mediante Foundation",
        subject="Control de gastos Q3",
    )
    doc.addPageTemplates([PageTemplate(id="report", frames=[frame], onPage=page_chrome)])

    actual = [82400, 91750, 88300]
    budget = 90000
    total = sum(actual)
    quarter_budget = budget * 3
    variance = total - quarter_budget
    average = total / 3
    utilization = total / quarter_budget * 100

    story = [
        Spacer(1, 6 * mm),
        Paragraph("INFORME EJECUTIVO", styles["eyebrow"]),
        Paragraph("Variación presupuestaria de nube", styles["title"]),
        Paragraph("Tercer trimestre | Decisión ejecutiva | 9 de septiembre de 2026", styles["subtitle"]),
        Table(
            [[metric_card("GASTO TRIMESTRAL", money(total), "97.20% del presupuesto"),
              metric_card("VARIACION", money(abs(variance)), "Ahorro favorable", GREEN),
              metric_card("PROMEDIO MENSUAL", f"MXN {average:,.2f}", "MXN 2,516.67 bajo el limite")]],
            colWidths=[57 * mm, 57 * mm, 57 * mm],
            style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2)]),
        ),
        Spacer(1, 5 * mm),
        Paragraph("Lectura ejecutiva", styles["section"]),
        Table(
            [[Paragraph(
                "El trimestre cerró <b>dentro del presupuesto</b>, con un ahorro neto de "
                f"<b>{money(abs(variance))} ({abs(variance) / quarter_budget * 100:.2f}%)</b>. "
                "Agosto fue el único mes con sobregasto; los ahorros de julio y septiembre compensaron la desviación.",
                styles["callout"],
            )]],
            colWidths=[171 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EDF3FF")),
                ("LINEBEFORE", (0, 0), (0, -1), 3, BLUE),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]),
        ),
        Spacer(1, 4 * mm),
        spend_chart(),
        Paragraph("Variación mensual contra presupuesto", styles["section"]),
    ]

    rows = [
        ["Mes", "Gasto real", "Presupuesto", "Variación", "Variación %"],
        ["Julio", money(actual[0]), money(budget), money(actual[0] - budget), pct((actual[0] - budget) / budget * 100)],
        ["Agosto", money(actual[1]), money(budget), f"MXN +{actual[1] - budget:,.0f}", pct((actual[1] - budget) / budget * 100)],
        ["Septiembre", money(actual[2]), money(budget), money(actual[2] - budget), pct((actual[2] - budget) / budget * 100)],
        ["Trimestre", money(total), money(quarter_budget), money(variance), pct(variance / quarter_budget * 100)],
    ]
    styled_rows = []
    for idx, row in enumerate(rows):
        if idx == 0:
            styled_rows.append([Paragraph(v, styles["table_header"]) for v in row])
        else:
            left_style = styles["table_total"] if idx == len(rows) - 1 else styles["table_cell"]
            right_style = styles["table_total_right"] if idx == len(rows) - 1 else styles["table_cell_right"]
            styled_rows.append([Paragraph(row[0], left_style)] + [Paragraph(v, right_style) for v in row[1:]])

    story.extend([
        Table(
            styled_rows,
            colWidths=[27 * mm, 37 * mm, 37 * mm, 36 * mm, 31 * mm],
            repeatRows=1,
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("BACKGROUND", (0, -1), (-1, -1), PANEL),
                ("GRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]),
        ),
        Spacer(1, 4 * mm),
        Paragraph("Recomendación", styles["section"]),
        Table(
            [[Paragraph(
                "Mantener el presupuesto mensual de <b>MXN 90,000</b>. Activar una alerta preventiva al alcanzar "
                "<b>MXN 81,000 (90%)</b> y revisar los impulsores del incremento observado en agosto. "
                "Reevaluar el límite después de contar con otro trimestre comparable.",
                styles["body"],
            )]],
            colWidths=[171 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ECF8F3")),
                ("LINEBEFORE", (0, 0), (0, -1), 3, GREEN),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]),
        ),
        PageBreak(),
        Spacer(1, 6 * mm),
        Paragraph("CONTROL Y TRAZABILIDAD", styles["eyebrow"]),
        Paragraph("Validación de los cálculos", styles["title"]),
        Paragraph("Conciliación independiente de cifras y criterios de revisión humana", styles["subtitle"]),
    ])

    checks = [
        "Julio: 82,400 - 90,000 = -7,600; variación de -8.44%.",
        "Agosto: 91,750 - 90,000 = +1,750; variación de +1.94%.",
        "Septiembre: 88,300 - 90,000 = -1,700; variación de -1.89%.",
        "Total: 82,400 + 91,750 + 88,300 = 262,450.",
        "Presupuesto trimestral: 3 x 90,000 = 270,000.",
        "Variación trimestral: 262,450 - 270,000 = -7,550; equivalente a -2.80%.",
        "Promedio mensual: 262,450 / 3 = 87,483.33.",
        "Conciliación: -7,600 + 1,750 - 1,700 = -7,550.",
    ]
    story.append(Table(
        [[Paragraph(f"<font color='#0B8F62'><b>OK</b></font>&nbsp;&nbsp;{item}", styles["check"])] for item in checks],
        colWidths=[171 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), PANEL),
            ("BOX", (0, 0), (-1, -1), 0.5, LINE),
            ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]),
    ))
    story.extend([
        Spacer(1, 7 * mm),
        Paragraph("Criterios para la decisión humana", styles["section"]),
        KeepTogether([
            Paragraph("1. Las cifras del resumen concilian con la tabla mensual.", styles["body"]),
            Paragraph("2. El sobregasto de agosto está identificado y tiene una acción de seguimiento.", styles["body"]),
            Paragraph("3. El informe distingue claramente datos demostrativos de informacion real.", styles["body"]),
            Paragraph("4. La aprobación acepta este entregable; no certifica datos financieros externos.", styles["body"]),
        ]),
        Spacer(1, 7 * mm),
        Table(
            [[Paragraph("PROCEDENCIA", styles["metric_label"]), Paragraph("ESTADO", styles["metric_label"]), Paragraph("DECISION", styles["metric_label"])],
             [Paragraph("Generado por un agente en Foundation", styles["body"]), Paragraph("Cálculos conciliados", styles["body"]), Paragraph("Listo para revisión humana", styles["body"])]],
            colWidths=[67 * mm, 48 * mm, 56 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E9EBEF")),
                ("BACKGROUND", (0, 1), (-1, 1), PANEL),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]),
        ),
        Spacer(1, 8 * mm),
        Table(
            [[Paragraph("AVISO", styles["metric_label"]), Paragraph(
                "Todos los valores, nombres y conclusiones de este documento son ficticios y se presentan únicamente para demostrar el flujo de trabajo de Foundation.",
                styles["small"],
            )]],
            colWidths=[25 * mm, 146 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF5E6")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#F0C77B")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]),
        ),
    ])

    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    build_pdf()
