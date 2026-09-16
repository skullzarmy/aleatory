# Mint-time parameters

A generator can let whoever mints it choose a few things first. Up to five named
inputs, set before they sign, stored on the token beside the seed. The piece is
then a function of its code, its seed and those values.

Most generators declare none, and that is the ordinary case. This document is
for the two people who need the detail: an artist adding parameters to a
generator, and anyone building a mint form for someone else's.

Everything a mint form needs is in the generator's own metadata, so a form can
be built for any Aleatory generator without our code and without running the
artwork. The second half of this page is that contract.

---

## For an artist

### Declaring them

Parameters are declared in your own file, and the studio reads them from there.
Any of these work:

```html
<meta name="alea:params" content='[{"id":"density", …}]'>
```

```js
window.$alea.paramsSchema = [ … ];   // what the starter kits write
ALEA_PARAMS = [ … ];                 // the same list under its own name
$fx.params([ … ]);                   // an fxhash project, converted on import
```

The file is read, never executed, so an uploaded generator cannot run on the
studio's origin before you have looked at it. The reader handles the loose ends
of real JavaScript: unquoted keys, single quotes, trailing commas, comments, and
numbers strict JSON would refuse. A schema assembled by a function call cannot
be read this way, and is declined rather than guessed at.

If a line assigns the schema twice, the last one wins, which is what the file
itself would do. The starter kits open with an empty assignment above your
declaration for exactly that reason.

A bad field costs one parameter and not the set. A name that will not do, a step
wider than its own range, or an id that collides with another once cleaned up
gets dropped with a line saying which and why, and the others carry on. Ids are
never silently repaired, because `$alea.param("density")` reads the id back when
the piece draws, and a renamed one is a control wired to nothing.

The studio's parameter panel edits the declaration in your file, the same way
the library picker edits your `alea:library` tags. There is one copy and it is
yours. Take the file elsewhere for a week, bring it back, and it still says what
it wants.

### What the artwork receives

Values are resolved and injected before any of your code runs:

```js
$alea.param("density", 140)   // the resolved value, or the fallback you pass
$alea.params                  // { density: 140, ink: "black" }
$alea.paramsSchema            // the declaration itself
```

Reading a name you never declared still returns the fallback and still draws,
but it is recorded as a violation and the studio's checks will stop you
publishing. A control nobody can see is one no collector will ever reach, and
the cause is almost always a rename that happened in one place.

Running locally, outside the sandbox, the dev harness in every starter kit takes
values from the URL: `?p.density=220&p.ink=red`.

### Two things worth knowing

`$fx.params([...])` does not declare anything here. On fxhash a project declares
its parameters by calling that at load time, which means finding out what
controls to draw requires running the artwork. A mint form should never have to
do that, so the declaration lives in chain state instead. The call is not
ignored: the studio spots it on import and offers to bring the declaration into
the panel, so a project arrives with its controls intact.

The seed is still meant to do the interesting work. A parameter is a dimension
you are handing over on purpose, and the range you declare is a promise that the
piece is worth looking at across it.

---

## The declaration

Written to the generator's `aleatory:params` metadata key at publish. A
generator with no parameters has no key at all, so an absent key and an empty
declaration never have to mean the same thing.

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
| `id` | yes | The key the artwork reads. `^[a-z][a-z0-9_]{0,23}$`. Unique within the generator, and fixed once published. |
| `label` | yes | What a person reads on the control. |
| `type` | yes | One of the five below. |
| `min` `max` `step` | `number`, `int` | The range and the grid it snaps to. `step` above 0 and no wider than `max - min`. |
| `options` | `select` | Two or more distinct strings. |
| `default` | yes | Used when no value is given, and whenever one fails to resolve. Must be in range, or among the options. |
| `hint` | no | One line, shown under the control. |

| `type` | JSON value | Control |
|---|---|---|
| `number` | number | slider, `min`…`max` by `step` |
| `int` | number, integral | slider, `min`…`max` by `step` |
| `bool` | `true` / `false` | toggle |
| `color` | `"#rrggbb"`, lowercase | colour picker |
| `select` | one of `options` | dropdown |

Five entries at most. A reader that meets a sixth, or a `type` it does not know,
should drop that entry and render the others. The piece still has a seed, and a
partly drawn form is worth more than none.

---

## Resolving a value

Raw input in, the values the piece actually sees out. Every implementation has
to agree here, or one token draws two ways.

Per declared parameter, in order:

1. No entry for `id`, or one that cannot be coerced to the declared type, gives
   `default`.
2. `number` and `int`: coerce to a finite number, clamp to `[min, max]`, snap to
   the grid as `min + round((v - min) / step) * step` capped at `max`, then round
   to six decimal places. `int` rounds to a whole number.
3. `bool`: `true` and `false`, and the strings `"true"` and `"false"`. Anything
   else gives `default`.
4. `color`: `#rrggbb` in either case, emitted lowercase. Anything else gives
   `default`.
5. `select`: an exact member of `options`. Anything else gives `default`.
6. Keys the schema does not declare are dropped.

A value outside the range is corrected rather than refused. Refusing would mint
tokens that some viewers can draw and others cannot.

Reference implementation: `resolveParams` in `src/lib/params.ts`.

### Encoding

A JSON object, keys in declaration order rather than sorted, values already
resolved:

```json
{"density":140,"ink":"black"}
```

Declaration order because it is the one ordering a third party can reconstruct
from the record alone. The bytes matter: these strings are quoted, compared and
hashed.

---

## Where the values live

| What | Where |
|---|---|
| The declaration | the generator's `aleatory:params` metadata key |
| The resolution rule | this document. It is the same for every generator. |
| One piece's values | the `mint` operation that created it, and `aleaParams` in that token's metadata |

---

## Building a mint form

Given a generator's address:

1. Read its metadata big map and take `aleatory:params`. Absent means no
   parameters, so mint as normal.
2. Render one control per entry, per the tables above. `label` goes over it,
   `hint` under it, and it starts at `default`.
3. Resolve what the collector set, exactly as described above.
4. Preview by running the generator's code with the resolved values.
5. Encode canonically and pass that to `mint`. It is recorded in the operation,
   and whoever publishes the piece's metadata copies it into `aleaParams`.

There is nothing to register for and no key to ask us for. A generator's mint
form follows from its own record.

---

## Determinism

Code, seed and parameters together are still a pure function. Two of the three
are chosen by people now, which is why the resolution rule above is written to
the digit.

- The studio's determinism check runs both passes with the same parameters, so
  it tests the piece rather than the tuning.
- The seed grid holds parameters fixed and varies only the seed, which is the
  only way to see what the seed alone is doing.
- A trait derived from a parameter is a real trait, and two collectors can share
  one. A seed-derived trait could not do that.

---

## Limits

- **No free text and no unbounded numbers.** A text box is a caption rather than
  a dimension of the work. Imported fxhash `string` parameters are dropped, and
  the import says so.
- **Five is the ceiling**, checked when a declaration is read and again on
  import.
- **`artifactUri` does not carry the values.** It points at the code, and a
  renderer applies `aleaParams` through the harness. Baking values into the URI
  depends on how the harness itself is served, which is a later question.
- **Published values can be checked but not enforced.** The values are in the
  mint operation and the code cannot change, so anyone can draw the piece again
  and compare. Nothing on chain compels the published metadata to match. This is
  the same position as the seed.
