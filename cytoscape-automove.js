;(function(){ 'use strict';

  var defaults = {
    // specify nodes that should be automoved with one of
    // - a function that returns true for matching nodes
    // - a selector that matches the nodes
    // - a collection or array of nodes (very good for performance)
    nodesMatching: function( node ){ return false; },

    // specify how a node's position should be updated with one of
    // - function( node ){ return { x: 1, y: 2 }; } => put the node where the function returns
    // - { x1, y1, x2, y2 } => constrain the node position within the bounding box (in model co-ordinates)
    // - 'mean' => put the node in the average position of its neighbourhood
    // - 'viewport' => keeps the node body within the viewport
    reposition: 'mean',

    // for `reposition: 'mean'`, specify nodes that should be ignored in the mean calculation
    // - a function that returns true for nodes to be ignored
    // - a selector that matches the nodes to be ignored
    // - a collection or array of nodes to be ignored (very good for performance)
    meanIgnores: function( node ){ return false; },

    // specify when the repositioning should occur by specifying a function that
    // calls update() when reposition updates should occur
    // - function( update ){ /* ... */ update(); } => a manual function for updating
    // - 'matching' => automatically update on position events for nodesMatching
    // - set efficiently and automatically for
    //   - reposition: 'mean'
    //   - reposition: { x1, y1, x2, y2 }
    //   - reposition: 'viewport'
    // - default/undefined => on a position event for any node (not as efficient...)
    when: undefined
  };

  var typeofStr = typeof '';
  var typeofObj = typeof {};
  var typeofFn = typeof function(){};

  var isObject = function( x ){ return typeof x === typeofObj; };
  var isString = function( x ){ return typeof x === typeofStr; };
  var isFunction = function( x ){ return typeof x === typeofFn; };
  var isCollection = function( x ){ return isObject( x ) && isFunction( x.collection ) };

  // Object.assign() polyfill
  var assign = Object.assign ? Object.assign.bind( Object ) : function( tgt ){
    var args = arguments;

    for( var i = 1; i < args.length; i++ ){
      var obj = args[i];

      for( var k in obj ){ tgt[k] = obj[k]; }
    }

    return tgt;
  };

  var eleExists = function( ele ){
    return ele != null && !ele.removed();
  };

  var elesHasEle = function( eles, ele ){
    if( eles.has != undefined ){ // 3.x
      elesHasEle = function( eles, ele ){ return eles.has( ele ); };
    } else { // 2.x
      elesHasEle = function( eles, ele ){ return eles.intersection( ele ).length > 0; };
    }

    return elesHasEle( eles, ele );
  };

  var getEleMatchesSpecFn = function( spec ){
    if( isString( spec ) ){
      return function( ele ){
        return ele.is( spec );
      };
    } else if( isFunction( spec ) ){
      return spec;
    } else if( isCollection( spec ) ){
      return function( ele ){
        return elesHasEle( spec, ele );
      };
    } else {
      throw new Error('Can not create match function for spec', spec);
    }
  };

  var bindings = [];

  var bind = function( cy, events, selector, fn ){
    var b = { cy: cy, events: events, selector: selector || 'node', fn: fn };

    bindings.push( b );

    cy.on( b.events, b.selector, b.fn );

    return b;
  };

  var bindOnRule = function( rule, cy, events, selector, fn ){
    var b = bind( cy, events, selector, fn );
    var bindings = rule.bindings = rule.bindings || [];

    bindings.push( b );
  };

  var unbindAll = function( cy ){
    var sameCy = function( b ){ return cy === b.cy; };
    var unbind = function( b ){ b.cy.off( b.events, b.selector, b.fn ); };

    bindings.filter( sameCy ).forEach( unbind );

    bindings = [];
  };

  var unbindAllOnRule = function( rule ){
    var unbind = function( b ){ b.cy.off( b.events, b.selector, b.fn ); };

    rule.bindings.forEach( unbind );

    rule.bindings = [];
  };

  var getRepositioner = function( rule, cy ){
    var r = rule.reposition;

    if( r === 'mean' ){
      return meanNeighborhoodPosition( getEleMatchesSpecFn( rule.meanIgnores ) );
    } else if( r === 'viewport' ){
      return viewportPosition( cy );
    } else if( isObject( r ) ){
      return boxPosition( r );
    } else {
      return r;
    }
  };

  var meanNeighborhoodPosition = function( ignore ){
    return function( node ){
      var nhood = node.neighborhood();
      var avgPos = { x: 0, y: 0 };
      var nhoodSize = 0;

      for( var i = 0; i < nhood.length; i++ ){
        var nhoodEle = nhood[i];

        if( nhoodEle.isNode() && !ignore( nhoodEle ) ){
          var pos = nhoodEle.position();

          avgPos.x += pos.x;
          avgPos.y += pos.y;

          nhoodSize++;
        }
      }

      avgPos.x /= nhoodSize;
      avgPos.y /= nhoodSize;

      return avgPos;
    };
  };

  var constrain = function( val, min, max ){
    return val < min ? min : ( val > max ? max : val );
  };

  var constrainInBox = function( node, bb ){
    var pos = node.position();

    return {
      x: constrain( pos.x, bb.x1, bb.x2 ),
      y: constrain( pos.y, bb.y1, bb.y2 )
    };
  };

  var boxPosition = function( bb ){
    return function( node ){
      return constrainInBox( node, bb );
    };
  };

  var viewportPosition = function( cy ){
    return function( node ){
      var extent = cy.extent();
      var w = node.outerWidth();
      var h = node.outerHeight();
      var bb = {
        x1: extent.x1 + w/2,
        x2: extent.x2 - w/2,
        y1: extent.y1 + h/2,
        y2: extent.y2 - h/2
      };

      return constrainInBox( node, bb );
    };
  };

  var meanListener = function( rule ){
    return function( update, cy ){
      var matches = function( ele ){
        // must meet ele set and be connected to more than (1 edge + 1 node)
        return rule.matches( ele ) && ele.neighborhood().length > 2;
      };

      bindOnRule( rule, cy, 'position', 'node', function(){
        var movedNode = this;

        if( movedNode.neighborhood().some( matches ) ){
          update( cy, [ rule ] );
        }
      });

      bindOnRule( rule, cy, 'add remove', 'edge', function(){
        var edge = this;
        var src = cy.getElementById( edge.data('source') );
        var tgt = cy.getElementById( edge.data('target') );

        if( [ src, tgt ].some( matches ) ){
          update( cy, [ rule ] );
        }
      });
    };
  };

  var matchingNodesListener = function( rule ){
    return function( update, cy ){
      bindOnRule( rule, cy, 'position', 'node', function(){
        var movedNode = this;

        if( rule.matches( movedNode ) ){
          update( cy, [ rule ] );
        }
      });
    };
  };

  var getListener = function( cy, rule ){
    if( rule.reposition === 'mean' ){
      return meanListener( rule );
    } else if(
      isObject( rule.reposition )
      || rule.when === 'matching'
      || rule.reposition === 'viewport'
    ){
      return matchingNodesListener( rule );
    } else {
      return rule.when;
    }
  };

  var addRule = function( cy, scratch, options ){
    var rule = assign( {}, defaults, options );

    rule.getNewPos = getRepositioner( rule, cy );
    rule.listener = getListener( cy, rule );

    var nodesAreCollection = isCollection( rule.nodesMatching );

    if( nodesAreCollection ){
      rule.nodes = rule.nodesMatching;

      rule.matches = function( ele ){ return eleExists( ele ) && elesHasEle( rule.nodes, ele ); };
    } else {
      var matches = getEleMatchesSpecFn( rule.nodesMatching );

      rule.matches = function( ele ){ return eleExists( ele ) && matches( ele ) };
    }

    rule.listener( function(){
      update( cy, [ rule ] );
    }, cy );

    rule.enabled = true;

    scratch.rules.push( rule );

    return rule;
  };

  var bindForNodeList = function( cy, scratch ){
    scratch.onAddNode = function( evt ){
      var target = evt.target;

      scratch.nodes.push( target );
    };

    cy.on('add', 'node', scratch.onAddNode);
  };

  var unbindForNodeList = function( cy, scratch ){
    cy.removeListener('add', 'node', scratch.onAddNode);
  };

  var update = function( cy, rules ){
    var scratch = cy.scratch().automove;

    rules = rules != null ? rules : scratch.rules;

    cy.batch(function(){ // batch for performance
      for( var i = 0; i < rules.length; i++ ){
        var rule = rules[i];

        if( rule.destroyed || !rule.enabled ){ break; } // ignore destroyed rules b/c user may use custom when()

        var nodes = rule.nodes || scratch.nodes;

        for( var j = nodes.length - 1; j >= 0; j-- ){
          var node = nodes[j];

          if( node.removed() ){ // remove from list for perf
            nodes.splice( j, 1 );
            continue;
          }

          if( !rule.matches(node) ){ continue; }

          var pos = node.position();
          var newPos = rule.getNewPos( node );
          var newPosIsDiff = pos.x !== newPos.x || pos.y !== newPos.y;

          if( newPosIsDiff ){ // only update on diff for perf
            node.position( newPos );

            node.trigger('automove');
          }
        }
      }
    });
  };

  // registers the extension on a cytoscape lib ref
  var register = function( cytoscape ){

    if( !cytoscape ){ return; } // can't register if cytoscape unspecified

    cytoscape( 'core', 'automove', function( options ){
      var cy = this;

      var scratch = cy.scratch().automove = cy.scratch().automove || {
        rules: []
      };

      if( scratch.rules.length === 0 ){
        scratch.nodes = cy.nodes().toArray();

        bindForNodeList( cy, scratch );
      }

      if( options === 'destroy' ){
        scratch.rules.forEach(function( r ){ r.destroy(); });
        scratch.rules.splice( 0, scratch.rules.length );

        unbindForNodeList( cy, scratch );

        return;
      }

      var rule = addRule( cy, scratch, options );

      update( cy, [ rule ] ); // do an initial update to make sure the start state is correct

      return {
        apply: function(){
          update( cy, [ rule ] );
        },

        disable: function(){
          this.toggle( false );
        },

        enable: function(){
          this.toggle( true );
        },

        enabled: function(){
          return rule.enabled;
        },

        toggle: function( on ){
          rule.enabled = on !== undefined ? on : !rule.enabled;

          if( rule.enabled ){
            update( cy, [ rule ] );
          }
        },

        destroy: function(){
          var rules = scratch.rules;

          unbindAllOnRule( rule );

          rules.splice( rules.indexOf( rule ), 1 );

          if( rules.length === 0 ){
            unbindForNodeList( cy, scratch );
          }

          return this;
        }
      };
    } );

  };

  if( typeof module !== 'undefined' && module.exports ){ // expose as a commonjs module
    module.exports = register;
  } else if( typeof define !== 'undefined' && define.amd ){ // expose as an amd/requirejs module
    define('cytoscape-automove', function(){
      return register;
    });
  }

  if( typeof cytoscape !== 'undefined' ){ // expose to global cytoscape (i.e. window.cytoscape)
    register( cytoscape );
  }

})();
