; Inheritance: class Foo extends Bar
; extends_clause value is an identifier (not type_identifier)
(class_declaration
  name: (type_identifier) @edge.extends.from
  (class_heritage
    (extends_clause
      value: [(identifier) (type_identifier)] @edge.extends.to))) @edge.extends.context

; Implements: class Foo implements Bar, Baz
(class_declaration
  name: (type_identifier) @edge.implements.from
  (class_heritage
    (implements_clause
      (type_identifier) @edge.implements.to))) @edge.implements.context

; Import: import { Foo } from './path'
(import_statement
  (import_clause
    (named_imports
      (import_specifier
        name: (identifier) @edge.imports.name)))
  source: (string) @edge.imports.from) @edge.imports.context

; Method call: foo.bar(...)
(call_expression
  function: (member_expression
    property: (property_identifier) @edge.calls.method)) @edge.calls.context
