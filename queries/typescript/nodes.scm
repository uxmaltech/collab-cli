; Clase
(class_declaration
  name: (type_identifier) @node.class.name) @node.class

; Interfaz
(interface_declaration
  name: (type_identifier) @node.interface.name) @node.interface

; Función top-level
(function_declaration
  name: (identifier) @node.function.name) @node.function

; Método dentro de clase
(method_definition
  name: (property_identifier) @node.function.name) @node.function

; Arrow function asignada a const
(lexical_declaration
  (variable_declarator
    name: (identifier) @node.function.name
    value: (arrow_function))) @node.function
