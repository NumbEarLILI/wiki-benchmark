"""计算星云云对象存储的月度存储费用。用法：python3 oss_price.py <standard|infrequent|archive> <GB>"""
import sys

PRICES = {"standard": 0.12, "infrequent": 0.08, "archive": 0.033}

if len(sys.argv) != 3 or sys.argv[1] not in PRICES:
    print(__doc__)
    sys.exit(1)

kind, gb = sys.argv[1], float(sys.argv[2])
print(f"{kind} 存储 {gb:g} GB 每月费用：{PRICES[kind] * gb:.2f} 元（单价 {PRICES[kind]} 元/GB/月）")
