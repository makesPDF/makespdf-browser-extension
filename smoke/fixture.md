# Smoke fixture

A public Markdown file with the things the manual smoke exercises: a relative
image (Markdown form), a relative image (HTML form), a Mermaid diagram, and a
link to a second file for soft-navigation checks.

![logo](./logo.png)

<img src="./logo.png" width="96" alt="logo" />

```mermaid
graph LR
  A[GitHub .md] --> B[makesPDF] --> C[PDF]
```

Image-like text inside code is literal and must NOT be inlined:

```
![not real](./does-not-exist.png)
```

Next: [second.md](./second.md)
