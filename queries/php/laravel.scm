; event(new SomeEvent())
(function_call_expression
  function: [(name) (qualified_name)] @edge.dispatches.fn
  (#match? @edge.dispatches.fn "^(event)$")
  arguments: (arguments
    (argument
      [(object_creation_expression
         (name) @edge.dispatches.event)
       (object_creation_expression
         (qualified_name) @edge.dispatches.event)]))) @edge.dispatches.context

; dispatch(new SomeJob())
(function_call_expression
  function: [(name) (qualified_name)] @edge.triggers.fn
  (#match? @edge.triggers.fn "^(dispatch)$")
  arguments: (arguments
    (argument
      (object_creation_expression
        [(name) (qualified_name)] @edge.triggers.job)))) @edge.triggers.context

; Route::get('/path', ...) Route::post(...) etc.
; In tree-sitter-php the node is scoped_call_expression with scope:/name:/arguments: fields
(scoped_call_expression
  scope: (name) @edge.route.class
  (#eq? @edge.route.class "Route")
  name: (name) @edge.route.method
  arguments: (arguments
    (argument) @edge.route.uri)) @edge.route.context
