# Mint-time parameters, Aleatory

**Status:** v0, implemented, 2026-08-23. This is a spec: another platform should be able to build a mint UI for an Aleatory generator from this document alone, without reading our source and without executing the artwork.

A generator may declare **up to five** named inputs that whoever mints a piece sets before they sign. The values are stored on the token beside the seed, and the piece becomes a pure function of **(code, seed, params)**.

Parameters are **always optional**. Most generators declare none, and a generator that declares none is not a lesser one, it is the default shape of the thing.

---

## 1. Why it is shaped this way

EditArt gave every project the same five unnamed sliders. That is a mechanism, not a language: a parameter meant whatever the artist could persuade a collector it meant, controls could not be labelled, ranges could not be stated, and nothing downstream could render a sensible UI because nothing downstream knew what it was rendering.

So: **the artist names them, sets the range, and writes the default.** A declaration is legible without context, which is what makes the rest of this document possible, a mint page that has never heard of the artist can still put the right control on the screen with the right label above it.

The five-parameter ceiling is kept. Not for storage reasons; because a collector who is handed nine sliders stops reading and starts dragging.

**Where the line sits.** The seed should still do the interesting work. A parameter is a dimension the artist hands over deliberately. It is not a way to make the collector responsible for whether the piece is any good, and a generator whose output is bad across most of its own declared range has declared the wrong range.

---

## 2. The declaration

JSON, written under the collection's `aleatory:params` metadata key when a generator declares anything. One key, one place to read it, which is what §5 is for.

**A generator declares its own parameters, in the file.** The studio reads that declaration when the file is uploaded and seeds the params panel with it, so an artist who already wrote their ranges down does not type them a second time and is not punished for a typo in the retyping. Four forms are read:

```html
<meta name="alea:params" content='[{"id":"density", …}]'>
```

```js
window.$alea.paramsSchema = [ … ];   // what the starter kits write
ALEA_PARAMS = [ … ];                 // the same list under its own name
$fx.params([ … ]);                   // an fxhash piece, converted on the way in
```

Read by a parser for the literal subset of JavaScript. **Nothing is evaluated**: an uploaded file is a stranger's code, and it never runs on the studio's own origin. Unquoted keys, single quotes, trailing commas, comments and numbers JSON rejects all parse; a schema built by a function call is declined instead of guessed at.

The last literal assignment wins, which is what the file itself does with those lines. A generator assigning `paramsSchema` twice runs with the second, and the starter kits open with a dev harness assigning an empty array before the artist's declaration.

One bad field costs one parameter, never the set. An unusable name, a step larger than its range, or a second id that collides once cleaned is dropped with a line saying so, and the rest survive. Ids are never repaired: `alea.param("density")` reads the id back at render time, so a renamed one is a control that tunes nothing.

**The document is the record.** The studio's params panel edits the declaration in the file, the way the library picker edits the `alea:library` tags, so there is one copy and it is the artist's own file. Export it, work on it elsewhere for a week, bring it back, and it still says what it wants. What lands under `aleatory:params` at publish is read from the document.

```json
{
  "version": 1,
  "params": [
    { "id": "density", "label": "Density", "type": "int",
      "min": 40, "max": 320, "step": 10, "default": 140,
      "hint": "How many marks are drawn." },
    { "id": "ink", "label": "Ink", "type": "select",
      "options": ["black", "red", "blue"], "default": "black" }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | The key the artwork reads. `^[a-z][a-z0-9_]{0,23}$`. Unique within the generator, immutable once published. |
| `label` | yes | What a person reads on the control. |
| `type` | yes | One of the five below. |
| `min` `max` `step` | `number`, `int` | The range and the quantization grid. `step` > 0 and ≤ `max - min`. |
| `options` | `select` | Two or more distinct strings. |
| `default` | yes | Used when no value is given, and whenever a value fails to resolve. Must be in range / among the options. |
| `hint` | no | One line, shown under the control. |

### Types

| `type` | JSON value | Control to render |
|---|---|---|
| `number` | number | slider, `min`…`max` by `step` |
| `int` | number (integral) | slider, `min`…`max` by `step` |
| `bool` | `true` / `false` | toggle |
| `color` | `"#rrggbb"`, lowercase | colour picker |
| `select` | one of `options` | dropdown |

At most five entries. A reader encountering more, or an entry with an unknown `type`, should **drop that entry and render the rest** rather than refuse the generator, the piece still has a seed, and a partly-rendered mint form beats none.

---

## 3. Resolution, the part that has to match exactly

Raw input in, the values a piece actually sees out. Every implementation must produce identical results, or the same token renders differently in two places and determinism is decorative.

The rule, in order, per declared parameter:

1. If the input has no entry for `id`, or the entry cannot be coerced to the declared type → **use `default`**.
2. `number` / `int`: coerce to a finite number; clamp to `[min, max]`; snap to the grid, `min + round((v - min) / step) * step`, capped at `max`; round to **6 decimal places**; for `int`, round to an integer.
3. `bool`: accept `true`/`false`, and the strings `"true"`/`"false"`. Anything else → `default`.
4. `color`: accept `#rrggbb` case-insensitively, emit lowercase. Anything else → `default`.
5. `select`: accept only an exact member of `options`. Anything else → `default`.
6. Keys in the input that the schema does not declare are **dropped**.

An out-of-range value is corrected, never rejected. Refusing would produce tokens that some viewers can render and others cannot, which is the one outcome worth designing out.

The rule, in full, so a reader is never inferring it:

```
clamp to [min,max]; snap to the step grid from min; unknown keys dropped;
missing or unresolvable values fall back to default
```

Reference implementation: `src/lib/params.ts`, `resolveParams`.

### Canonical encoding

Values are written as a JSON object with **keys in declaration order**, not sorted, and values already resolved:

```json
{"density":140,"ink":"black"}
```

Declaration order because it is the only ordering a third party can reconstruct without our code. Byte-identical encodings matter because these strings get quoted, compared and hashed.

---

## 4. Where it all lives on chain

One contract per generator, deployed by the factory. Its metadata big_map
carries the declaration; its storage carries the code.

| What | Where |
|---|---|
| The declaration | the collection's `aleatory:params` metadata key |
| The resolution rule | this document, §3. It is the same for every generator. |
| One piece's values | the `mint` operation that created it, and `aleaParams` in that token's metadata JSON |

A generator that declares nothing has no `aleatory:params` key at all, so an
absent key and an empty declaration never both have to mean the same thing.

---

## 5. Building a mint UI for someone else's generator

The whole point. Given a generator contract address:

1. Read the collection's metadata big_map and take `aleatory:params`. Absent means the generator has no parameters: mint as normal.
2. Render one control per entry, per the table in §2. Use `label` above it and `hint` below it. Start at `default`.
3. Resolve what the user set, per §3.
4. Preview by rendering the generator's code with the resolved values, see §6.
5. Encode canonically per §3 and pass it to `mint`. It is recorded in that operation, and whoever publishes the piece's metadata copies it into the JSON under `aleaParams`.

That is the entire integration. No allowlist, no key, nothing to ask us for. A generator's mint UI is a function of its record, which is the property that stops us from being load-bearing.

---

## 6. What the artwork receives

The harness injects resolved values before any of the artist's code runs (`standard_version` 2 and up):

```js
$alea.param("density", 140)   // resolved value, else declared default, else the fallback
$alea.params                   // { density: 140, ink: "black" }
$alea.paramsSchema             // the declaration itself
```

The harness gives a piece one surface, `$alea`:

```js
$fx.getParam("density")
$fx.getParams()
```

Two deliberate behaviours:

- **A read of an undeclared name is reported** as a runtime violation. The fallback stands and the piece renders, but the checks fail it before publish, a value no control exists for is unreachable for every collector, forever, and it is nearly always a rename that happened in one place only.
- **`$fx.params([...])` does not declare anything.** fxhash projects declare their params by calling it at load time; here the declaration has to be readable from chain state, because a mint UI must never have to execute the artwork to find out what controls to draw. The call is not ignored, the studio catches it and offers to import the declaration into the params panel, so an imported project arrives with its controls intact.

Locally, outside the sandbox, the dev harness reads values from the URL: `?p.density=220&p.ink=red`.

---

## 7. Determinism, restated

`(code, seed, params)` is still a pure function. Two of the three inputs are now chosen by people, which raises the stakes on resolution rather than changing the guarantee:

- The determinism check runs both passes with **identical params**, so it tests the piece, not the tuner.
- The seed grid holds params **fixed** and varies only the seed, because that is the only way to read what the seed alone is doing.
- Traits (`features`) derived from a parameter are honest, and worth knowing about: two collectors can now share one, which a seed-derived trait could not do.

---

## 8. Known limits in v0

- **Params are set by whoever mints.** `mint` takes the resolved values, so what the collector chose is committed by their own signature in the operation that mints the piece. A provider reads them from that operation to know what to render, and anyone else reads them to check the result. The end-to-end path is not yet exercised on a testnet.
- **`artifactUri` does not carry the values.** It points at the code; a renderer applies `aleaParams` through the harness per §6. Baking values into the URI is a later question and depends on how the harness itself gets served.

- **A wrong `aleaParams` is detectable, not preventable.** The values are in the mint operation and the code is immutable, so anyone can re-render and compare, but nothing on chain forces the published metadata to match what the piece was minted with. Same posture as the seed.
- **No string or free-numeric type.** A free-text input is a caption, not a dimension of a piece. Imported fxhash `string` params are dropped, and said so out loud at import time.
- **The ceiling is five,** enforced at declaration time and at import.
