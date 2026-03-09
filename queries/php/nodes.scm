; Class
(class_declaration
  name: (name) @node.class.name) @node.class

; Interface
(interface_declaration
  name: (name) @node.interface.name) @node.interface

; Trait
(trait_declaration
  name: (name) @node.trait.name) @node.trait

; Enum
(enum_declaration
  name: (name) @node.enum.name) @node.enum

; Method inside class (parent node resolved at runtime)
(method_declaration
  name: (name) @node.function.name) @node.function
