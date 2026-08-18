from cloakbrowser import launch

browser = launch()
context = browser.new_context(ignore_https_errors=True)
page = context.new_page()
page.goto("https://example.com")
print(page.title())
browser.close()
