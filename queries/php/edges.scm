; Herencia: class Foo extends Bar
(class_declaration
  name: (name) @edge.extends.from
  (base_clause
    [(name) (qualified_name)] @edge.extends.to)) @edge.extends.context

; Implementa interfaz: class Foo implements Bar, Baz
; Los nombres de interfaz son hijos directos de class_interface_clause
(class_declaration
  name: (name) @edge.implements.from
  (class_interface_clause
    [(name) (qualified_name)] @edge.implements.to)) @edge.implements.context

; Implementa interfaz desde enum: enum Foo implements Bar
(enum_declaration
  name: (name) @edge.implements.from
  (class_interface_clause
    [(name) (qualified_name)] @edge.implements.to)) @edge.implements.context

; Uso de trait: use TraitName;
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

; Llamada a método: $obj->method(...)
(member_call_expression
  name: (name) @edge.calls.method) @edge.calls.context
