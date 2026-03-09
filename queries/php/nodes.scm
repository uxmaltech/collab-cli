; Clase
(class_declaration
  name: (name) @node.class.name) @node.class

; Interfaz
(interface_declaration
  name: (name) @node.interface.name) @node.interface

; Trait
(trait_declaration
  name: (name) @node.trait.name) @node.trait

; Enum
(enum_declaration
  name: (name) @node.enum.name) @node.enum

; Método dentro de clase (el nodo padre se resuelve en runtime)
(method_declaration
  name: (name) @node.function.name) @node.function
