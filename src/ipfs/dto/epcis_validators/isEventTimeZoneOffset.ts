import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export function IsEventTimeZoneOffset(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isEventTimeZoneOffset',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          // EPCIS format: ±hh:mm, where hh is 00-14, mm is 00-59, but if hh is 14, mm must be 00
          const match = value.match(/^([+-])(0[0-9]|1[0-4]):([0-5][0-9])$/);
          if (!match) return false;
          const hours = parseInt(match[2], 10);
          const minutes = parseInt(match[3], 10);
          if (hours === 14 && minutes !== 0) return false;
          return true;
        },
        defaultMessage(_args: ValidationArguments) {
          return 'eventTimeZoneOffset must match ±hh:mm (hh=00-14, mm=00-59, mm=00 if hh=14)';
        },
      },
    });
  };
}
