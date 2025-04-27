# gpt.py
from g4f.client import Client
import sys

def main():
    if len(sys.argv) < 2:
        print("Usage: python gpt.py \"Your message here\"", file=sys.stderr)
        sys.exit(1)

    msg = sys.argv[1]
    try:
        client = Client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": msg}],
            web_search=False
        )
        text = response.choices[0].message.content
        print(text, end="", flush=True)
        sys.exit(0)
    except Exception as e:
        # dump full traceback to stderr
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()