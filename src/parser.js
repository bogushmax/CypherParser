define([ 'parsimmon', 'utils' ], function (Parsimmon, Utils) {
    var string        = Parsimmon.string;
    var regex         = Parsimmon.regex;
    var succeed       = Parsimmon.succeed;
    var seq           = Parsimmon.seq;
    var seqMap        = Parsimmon.seqMap;
    var alt           = Parsimmon.alt;
    var lazy          = Parsimmon.lazy;
    var optWhitespace = Parsimmon.optWhitespace;
    var any           = Parsimmon.any;
    var custom        = Parsimmon.custom;
    var Types         = Utils.LexemesTypes;

    var concatenated = function (p) {
        return p.map(function (r) {
            return r.join('');
        });
    };
    var upperCase = function (p) {
        return p.map(function (r) {
            return r.toUpperCase();
        });
    };
    var lexeme = function (p) {
        return optWhitespace.then(p).skip(optWhitespace);
    };
    var optional = function (p) {
        return p.or(succeed([]));
    };
    var sepBy = function (sep, p) {
        var sepParser = sep.then(p).many();
        return optional(seqMap(p, sepParser, function (first, rest) {
            return [first].concat(rest);
        })).map(function (r) {
            return { type: Types.SEQUENCE, value: r };
        });
    };
    var commaSep = function (p) {
        return sepBy(base.comma, p);
    };

    /*
        Base lexemes
    */
    var base = {
        lsqbrack: lexeme(string('[')),
        rsqbrack: lexeme(string(']')),
        lbrace:       lexeme(string('{')),
        rbrace:       lexeme(string('}')),
        lbrack:       lexeme(string('(')),
        rbrack:       lexeme(string(')')),
        comma:        lexeme(string(',')),
        dot:          lexeme(string('.')),
        colon:        lexeme(string(':')),
        asterisk:     lexeme(string('*')),
        number:       lexeme(regex(/-?(0|[1-9]\d*)([.]\d+)?(e[+-]?\d+)?/i)),
        identifier:   lexeme(regex(/[A-Z][0-9A-Z]*/i)),
        nullLiteral:  lexeme(string('null')),
        trueLiteral:  lexeme(string('true')),
        falseLiteral: lexeme(string('false')),
        specialQuote: lexeme(string('`')),
        quoted:       lazy(function() {
            return lexeme(
                base.specialQuote.then(regex(/([A-Z0-9]|\s|[\u0400-\u04FF])*/i))
                .skip(base.specialQuote).or(base.identifier)).map(function (r) {
                return { type: Types.STRING, value: r };
            });
        }),
        property:     lazy(function() {
            return lexeme(seq(base.identifier, base.dot, base.quoted)).map(function (r) {
                return { type: Types.PROPERTY, node: r[0], name: r[2] };
            });
        }),
        booleanOperator: lexeme(regex(/(\=\~)|(IN)|(AND)|(OR)|(\=)|(\<\>)|(\>)|(\<)|(\|)/i)),
        arithmeticOperator: lexeme(regex(/(\+)|(\-)|(\*)|(\/)/i)),
        othersOperator:     lexeme(regex(/(\:)/i)),
        operator:           lazy(function () {
            return alt(base.booleanOperator, base.arithmeticOperator, base.othersOperator);
        })
    };

    /*
        Directives lexemes
    */
    var directives = {
        start:    upperCase(alt(lexeme(regex(/START/i)))),
        match:    upperCase(alt(lexeme(regex(/MATCH/i)),
                                lexeme(regex(/OPTIONAL\sMATCH/i)))),
        where:    upperCase(lexeme(regex(/WHERE/i))),
        return:   upperCase(lexeme(regex(/RETURN/i))),
        as:       upperCase(lexeme(regex(/AS/i))),
        distinct: upperCase(lexeme(regex(/DISTINCT/i)))
    };

    var sepByOperator = function (p) {
        var operatorParser = seq(base.operator, p).many();
        return optional(seqMap(p, operatorParser, function (first, rest) {
            return Array.prototype.concat.apply([first], rest);
        }));
    };

    var fun = lazy(function () {
        return seq(base.identifier,
                   base.lbrack,
                   optional(directives.distinct),
                   expressions.algebraic,
                   base.rbrack).map(function (r) {
            return { type: Types.FUNCTION, name: r[0], value: r[3], distinct: (r[2].length) ? true : false };
        });
    });

    var nodeDefinition = lazy(function () {
        return alt(
            seq(
                base.lbrack,
                base.identifier,
                base.colon,
                sepByOperator(base.quoted),
                base.rbrack
            ).map(function (r) {
                return { type: Types.NODE_DEFINITION, name: r[1], labels: r[3] };
            }),
            seq(
                base.lbrack,
                base.identifier,
                base.rbrack
            ).map(function (r) {
                return { type: Types.NODE_DEFINITION, name: r[1] };
            })
        )
    });

    var relationshipDefinition = lazy(function () {
        return alt(
            seq(
                base.lsqbrack,
                base.identifier,
                base.colon,
                sepByOperator(base.quoted),
                base.rsqbrack
            ).map(function (r) {
                return { type: Types.RELATIONSHIP_DEFINITION, name: r[1], rtypes: r[3] };
            }),
            seq(
                base.lsqbrack,
                base.identifier,
                base.rsqbrack
            ).map(function (r) {
                return { type: Types.RELATIONSHIP_DEFINITION, name: r[1] };
            })
        );
    });

    var directionDefinition = lazy(function () {
        return seq(
            alt(string('<-'), string('-')),
            relationshipDefinition,
            alt(string('->'), string('-'))
        );
    });

    var sepByDirection = function (p) {
        var operatorParser = seq(directionDefinition, p).many();
        return optional(seqMap(p, operatorParser, function (first, rest) {
            return Array.prototype.concat.apply([first], rest);
        }));
    };

    var expressions = {
        path: commaSep(sepByDirection(nodeDefinition)),
        any: regex(/(.|\s|\S)*?(?=(OPTIONAL\sMATCH|MATCH|WHERE|RETURN))/i).map(function (r) { return r.trim(); }),
        algebraic: lazy(function () {
            return alt(
                sepByOperator(alt(fun,
                                  expressions.kase,
                                  seq(base.lbrack, expressions.algebraic, base.rbrack),
                                  base.property,
                                  base.identifier,
                                  base.quoted,
                                  base.number,
                                  base.asterisk)),
                fun
            );
        }),
        kase: lazy(function () {
            return regex(/CASE(.|\s|\S)*?END/i).map(function (r) { return r.trim(); });
        })
    };

    var query = lazy(function () {
        return seq(
            optional(seq(directives.start, expressions.any)),
            optional(
                    seq(
                        directives.match,
                        expressions.path,
                        optional(
                            seq(
                                directives.where,
                                expressions.algebraic))).many()),
            seq(
                directives.return,
                commaSep(seq(
                             alt(expressions.algebraic, base.property),
                             optional(seq(directives.as, base.quoted))))));
    });

    var CypherError = function (message) {
        this.name = 'Cypher syntax error';
        this.message = message;
    };
    CypherError.prototype             = Object.create(Error.prototype);
    CypherError.prototype.constructor = CypherError;

    return {
        parse: function (cypherQuery) {
            var ast = query.parse(cypherQuery);
            if (!ast.status) throw new CypherError(ast.expected);
            return ast.value;
        }
    };
});