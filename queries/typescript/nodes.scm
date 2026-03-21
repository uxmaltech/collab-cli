; Class
(class_declaration
  name: (type_identifier) @node.class.name) @node.class

; Interface
(interface_declaration
  name: (type_identifier) @node.interface.name) @node.interface

; Top-level function
(function_declaration
  name: (identifier) @node.function.name) @node.function

; Method inside class
(method_definition
  name: (property_identifier) @node.function.name) @node.function

; Arrow function assigned to const
(lexical_declaration
  (variable_declarator
    name: (identifier) @node.function.name
    value: (arrow_function))) @node.function
