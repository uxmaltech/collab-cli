; Inheritance: class Foo extends Bar
(class_declaration
  name: (name) @edge.extends.from
  (base_clause
    [(name) (qualified_name)] @edge.extends.to)) @edge.extends.context

; Implements interface: class Foo implements Bar, Baz
; Interface names are direct children of class_interface_clause
(class_declaration
  name: (name) @edge.implements.from
  (class_interface_clause
    [(name) (qualified_name)] @edge.implements.to)) @edge.implements.context

; Implements interface from enum: enum Foo implements Bar
(enum_declaration
  name: (name) @edge.implements.from
  (class_interface_clause
    [(name) (qualified_name)] @edge.implements.to)) @edge.implements.context

; Trait usage: use TraitName;
(use_declaration
  [(name) (qualified_name)] @edge.uses_trait.to) @edge.uses_trait.context

; Namespace use import: use Foo\Bar\Baz;
(namespace_use_declaration
  (namespace_use_clause
    (qualified_name) @edge.uses_import.to)) @edge.uses_import.context

; Namespace use group import: use Foo\Bar\{Baz, Qux};
(namespace_use_declaration
  (namespace_use_group
    (namespace_use_clause) @edge.uses_import_group.to)) @edge.uses_import_group.context

; Method call: $obj->method(...)
(member_call_expression
  name: (name) @edge.calls.method) @edge.calls.context
